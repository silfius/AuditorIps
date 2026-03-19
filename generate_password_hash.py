#!/usr/bin/env python3
"""
Genera el hash PBKDF2-HMAC-SHA256 para la contraseña admin de Auditor IPs.
Uso:
    python3 generate_password_hash.py
    # o directamente:
    python3 generate_password_hash.py miContraseña

El hash resultante se pega en el .env como:
    ADMIN_PASSWORD_HASH=<hash>

O se puede establecer desde la UI en Config → Autenticación Admin → Cambiar contraseña.
"""

import os
import hashlib
import sys
import getpass


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 310_000)
    return f"{salt.hex()}${dk.hex()}"


if __name__ == "__main__":
    if len(sys.argv) > 1:
        pw = sys.argv[1]
    else:
        pw = getpass.getpass("Contraseña admin: ")
        pw2 = getpass.getpass("Repetir contraseña: ")
        if pw != pw2:
            print("ERROR: Las contraseñas no coinciden")
            sys.exit(1)

    if len(pw) < 8:
        print("ERROR: La contraseña debe tener al menos 8 caracteres")
        sys.exit(1)

    h = hash_password(pw)
    print(f"\n✓ Hash generado:\n{h}\n")
    print("Añade esta línea a tu .env:")
    print(f"ADMIN_PASSWORD_HASH={h}\n")
    print("O introdúcela en la UI: Config → Autenticación Admin → Cambiar contraseña")
