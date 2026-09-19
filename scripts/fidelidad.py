"""Fidelidad Neon → D1 por valores para un schema: por tabla compara conteo, suma de cada columna
numérica, min/max de cada columna de fecha y número de textos distintos por columna de texto.
Uso: python3 scripts/fidelidad.py <schema>   (respeta particiones.json: cada parte se compara con
las columnas que le tocan del original). Excluye created_at (default now()).
"""
import re, json, subprocess, sys, pathlib, math, os
RAIZ = pathlib.Path(__file__).resolve().parent.parent
ENV = pathlib.Path.home() / "datos-itam/api/.env.neon"
def url_neon():
    for line in open(ENV):
        if line.startswith('DATABASE_URL='):
            u=line.split('=',1)[1].strip().strip('"').strip("'").replace('postgresql+asyncpg://','postgresql://')
            u=re.sub(r'[?&]ssl=(require|true)','',u).rstrip('$'); return u+('&' if '?' in u else '?')+'sslmode=require'
def columnas(schema):
    cols={}; sec=None
    for line in open(RAIZ/f'docs/legacy/{schema}-postgres-schema.md', encoding='utf-8'):
        if line.startswith(f'# {schema} — columnas'): sec='col'; continue
        if line.startswith(f'# {schema} — constraints'): break
        if sec=='col' and ' | ' in line:
            t,c,ty,nul,df=[x.strip() for x in line.split(' | ',4)]; cols.setdefault(t,[]).append((c,ty))
    return cols
def expr(c,ty,motor):
    ty=ty.lower()
    if ty.startswith(('integer','smallint','bigint','numeric','double','real')):
        return f"round(coalesce(sum({c}),0)::numeric, 4)" if motor=='pg' else f"round(coalesce(sum({c}),0), 4)"
    if ty.startswith('boolean'): return f"sum(case when {c} then 1 else 0 end)" if motor=='pg' else f"sum({c})"
    if ty.startswith('date') or ty.startswith('timestamp'): return f"coalesce(min({c})::text || '|' || max({c})::text,'')" if motor=='pg' else f"coalesce(min({c}) || '|' || max({c}),'')"
    return f"count(distinct {c})"
def main(schema, solo=None):
    cols=columnas(schema); pg=url_neon(); base=RAIZ/f'data/{schema}'
    ddl=(base/'schema.sqlite.sql').read_text(encoding='utf-8')
    tablas=re.findall(r'^CREATE TABLE (?:IF NOT EXISTS )?(\w+) \(', ddl, flags=re.M)
    part=json.load(open(base/'particiones.json')) if (base/'particiones.json').exists() else {}
    origen={p['tabla']:(o,p['columnas']) for o,ps in part.items() for p in ps}
    planes=[]
    for t in tablas:
        if t.startswith('mv_'): continue
        if solo and t not in solo: continue
        o,sub=origen.get(t,(t,None))
        if o not in cols: continue
        cs=[(c,ty) for c,ty in cols[o] if c!='created_at' and (sub is None or c in sub)]
        planes.append((t,o,cs))
    res_pg={}
    for t,o,cs in planes:
        q=f"select count(*) as n, "+", ".join(f"{expr(c,ty,'pg')} as {c}" for c,ty in cs)+f" from {schema}.{o}"
        out=subprocess.run(['psql',pg,'-At','-F','\t','-c',q],capture_output=True,text=True)
        if out.returncode: print("psql error",t,out.stderr[:200]); sys.exit(1)
        res_pg[t]=out.stdout.strip().split('\t')
    ok=0; lineas=[]
    for i in range(0,len(planes),15):
        lote=planes[i:i+15]
        q="; ".join(f"select count(*) as n, "+", ".join(f"{expr(c,ty,'d1')} as {c}" for c,ty in cs)+f" from {t}" for t,o,cs in lote)
        def consultar(q):
            s=subprocess.run(['npx','wrangler','d1','execute',f'datosmexico-api-{schema}','--remote','--yes','--json','--command',q],capture_output=True,text=True).stdout
            s=s[s.find('['):]; d,_=json.JSONDecoder().raw_decode(s); return d
        d=consultar(q)
        if not all(isinstance(b,dict) and 'results' in b for b in d):
            # el lote falló (p. ej. sentencia demasiado larga): tabla por tabla
            d=[]
            for t,o,cs in lote:
                fila={}; error=None
                for k in range(0,max(1,len(cs)),90):
                    trozo=cs[k:k+90]
                    dd=consultar(f"select count(*) as n"+"".join(f", {expr(c,ty,'d1')} as {c}" for c,ty in trozo)+f" from {t}")
                    if dd and isinstance(dd[0],dict) and 'results' in dd[0]: fila.update(dd[0]['results'][0])
                    else: error='ERROR '+json.dumps(dd)[:120]; break
                d.append({'results':[fila]} if not error else {'results':[{'n':error}]})
        for (t,o,cs),bloque in zip(lote,d):
            r=bloque['results'][0]; difs=[]
            if isinstance(r.get('n'),str) and r['n'].startswith('ERROR'): lineas.append(f"- ✗ {t}: {r['n']}"); continue
            for (c,ty),vpg in zip([('n','integer')]+cs,res_pg[t]):
                vd1=r[c]
                if isinstance(vd1,(int,float)):
                    try:
                        if not math.isclose(float(vpg),float(vd1),rel_tol=1e-9,abs_tol=1e-4): difs.append(f"{c}: {vpg} vs {vd1}")
                    except ValueError:
                        if str(vpg)!=str(vd1): difs.append(f"{c}: {vpg} vs {vd1}")
                elif str(vpg)!=str(vd1 if vd1 is not None else ''): difs.append(f"{c}: {vpg!r} vs {vd1!r}")
            if difs: lineas.append(f"- ✗ {t}: "+"; ".join(difs[:5]))
            else: ok+=1; lineas.append(f"- ✓ {t}: {r['n']} filas, {len(cs)} columnas verificadas")
    texto=f"# Fidelidad Neon ≡ D1 — {schema}\n\n**{ok}/{len(planes)} tablas con fidelidad verificada por valores (sumas, rangos de fecha, distintos).**\n\n"+"\n".join(lineas)+"\n"
    (RAIZ/f'docs/paridad/{schema}-fidelidad-datos.md').write_text(texto,encoding='utf-8'); print(texto.splitlines()[2]); print("\n".join(l for l in lineas if l.startswith('- ✗')))
if __name__=='__main__': main(sys.argv[1], set(sys.argv[2:]) or None)
