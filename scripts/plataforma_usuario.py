"""Alta o cambio de contraseña de un usuario de la API (tabla users de la D1 datosmexico-api-plataforma).
Sustituye al create_admin.py del legacy. Genera el hash bcrypt localmente; la contraseña nunca viaja en claro
a ningún archivo: se pide por teclado o se toma de la variable PLATAFORMA_PASSWORD.
Uso: python3 scripts/plataforma_usuario.py <username> <email> [--admin]
"""
import getpass, os, pathlib, subprocess, sys, datetime
try: import bcrypt
except ImportError: sys.exit('instala bcrypt: python3 -m pip install bcrypt')
RAIZ = pathlib.Path(__file__).resolve().parent.parent
def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]; admin = '--admin' in sys.argv
    if len(args) != 2: sys.exit(__doc__)
    username, email = args
    pw = os.environ.get('PLATAFORMA_PASSWORD') or getpass.getpass('contraseña: ')
    h = bcrypt.hashpw(pw.encode(), bcrypt.gensalt(12)).decode()
    ahora = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d %H:%M:%S.%f')
    sql = ("INSERT INTO users (username, email, hashed_password, is_active, is_admin, created_at) VALUES ('%s','%s','%s',1,%d,'%s') "
           "ON CONFLICT(username) DO UPDATE SET hashed_password=excluded.hashed_password, email=excluded.email, is_admin=excluded.is_admin" % (username.replace("'", "''"), email.replace("'", "''"), h, 1 if admin else 0, ahora))
    r = subprocess.run(['npx', 'wrangler', 'd1', 'execute', 'datosmexico-api-plataforma', '--remote', '--yes', '--command', sql], cwd=RAIZ, capture_output=True, text=True)
    print('ok' if r.returncode == 0 and '✘' not in r.stdout + r.stderr else (r.stdout + r.stderr)[-300:])
if __name__ == '__main__': main()
