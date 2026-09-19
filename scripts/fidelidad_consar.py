"""Fidelidad Neon → D1 para CONSAR: compara, tabla por tabla, conteo, suma de cada columna
numérica, mínimo y máximo de cada columna de fecha, y número de textos distintos por columna de texto.
No basta con contar filas: esto detecta valores mal convertidos.
"""
import re, json, subprocess, sys, pathlib, math
RAIZ = pathlib.Path(__file__).resolve().parent.parent
ENV = pathlib.Path.home() / "datos-itam/api/.env.neon"

def url_neon():
    for line in open(ENV):
        if line.startswith('DATABASE_URL='):
            u=line.split('=',1)[1].strip().strip('"').strip("'").replace('postgresql+asyncpg://','postgresql://')
            u=re.sub(r'[?&]ssl=(require|true)','',u).rstrip('$'); return u+('&' if '?' in u else '?')+'sslmode=require'

def columnas():
    cols={}
    sec=None
    for line in open(RAIZ/'docs/legacy/consar-postgres-schema.md'):
        if line.startswith('# consar — columnas'): sec='col'; continue
        if line.startswith('# consar — constraints'): break
        if sec=='col' and ' | ' in line:
            t,c,ty,nul,df=[x.strip() for x in line.split(' | ',4)]
            cols.setdefault(t,[]).append((c,ty))
    return cols

def expr(c,ty,motor):
    ty=ty.lower()
    if ty.startswith(('integer','smallint','bigint','numeric','double','real')):
        return (f"round(coalesce(sum({c}),0)::numeric, 4)" if motor=='pg' else f"round(coalesce(sum({c}),0), 4)"), 'num'
    if ty.startswith('boolean'):
        return (f"sum(case when {c} then 1 else 0 end)" if motor=='pg' else f"sum({c})"), 'num'
    if ty.startswith('date') or ty.startswith('timestamp'):
        return (f"min({c})::text || '|' || max({c})::text" if motor=='pg' else f"min({c}) || '|' || max({c})"), 'txt'
    return f"count(distinct {c})", 'num'

def main():
    cols=columnas(); pg=url_neon()
    T=['afores','tipos_recurso','cat_siefore','afore_alias','afore_siefore_alias','cat_metrica_cuenta','cat_metrica_sensibilidad','cat_cuenta_etiqueta_agg','recursos_mensuales','comisiones','flujo_recurso','traspaso','pea_cotizantes','activo_neto','activo_neto_agg','cuenta_administrada','cuenta_administrada_agg','medida_sensibilidad','rendimiento','rendimiento_sis','precio_bolsa','precio_gestion']
    # excluir created_at (default now() distinto por naturaleza)
    q_pg=[]; q_d1=[]
    for t in T:
        cs=[(c,ty) for c,ty in cols[t] if c!='created_at']
        q_pg.append(f"select count(*) as n, "+", ".join(f"{expr(c,ty,'pg')[0]} as {c}" for c,ty in cs)+f" from consar.{t}")
        q_d1.append(f"select count(*) as n, "+", ".join(f"{expr(c,ty,'d1')[0]} as {c}" for c,ty in cs)+f" from {t}")
    # Neon
    res_pg=[]
    for q in q_pg:
        out=subprocess.run(['psql',pg,'-At','-F','\t','-c',q],capture_output=True,text=True)
        if out.returncode: print("psql error:",out.stderr[:300]); sys.exit(1)
        res_pg.append(out.stdout.strip().split('\t'))
    # D1
    s=subprocess.run(['npx','wrangler','d1','execute','datosmexico-api-consar','--remote','--yes','--json','--command',"; ".join(q_d1)],capture_output=True,text=True).stdout
    s=s[s.find('['):]; d,_=json.JSONDecoder().raw_decode(s)
    ok=0; lineas=[]
    for t,fila_pg,bloque in zip(T,res_pg,d):
        r=bloque['results'][0]; cs=[('n','integer')]+[(c,ty) for c,ty in cols[t] if c!='created_at']
        difs=[]
        for (c,ty),vpg in zip(cs,fila_pg):
            vd1=r[c]
            if isinstance(vd1,(int,float)) and vpg not in ('',None):
                try:
                    a=float(vpg); b=float(vd1)
                    if not math.isclose(a,b,rel_tol=1e-9,abs_tol=1e-4): difs.append(f"{c}: {vpg} vs {vd1}")
                except ValueError:
                    if str(vpg)!=str(vd1): difs.append(f"{c}: {vpg} vs {vd1}")
            else:
                if str(vpg)!=str(vd1 if vd1 is not None else ''): difs.append(f"{c}: {vpg!r} vs {vd1!r}")
        if difs: lineas.append(f"- ✗ {t}: "+"; ".join(difs[:5]))
        else: ok+=1; lineas.append(f"- ✓ {t}: {r['n']} filas, {len(cs)-1} columnas verificadas (sumas, rangos de fecha, distintos)")
    print(f"**{ok}/{len(T)} tablas con fidelidad verificada Neon ≡ D1.**\n"); print("\n".join(lineas))
    sys.exit(0 if ok==len(T) else 1)
if __name__=='__main__': main()
