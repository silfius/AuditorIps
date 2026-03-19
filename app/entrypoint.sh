#!/bin/bash
# ─────────────────────────────────────────────────────────────
# Auditor IPs — entrypoint.sh
# Genera certificado TLS autofirmado en el primer arranque.
# El cert y la CA se guardan en /data/certs/ (volumen persistente)
# para que puedas exportar la CA al móvil sin entrar al contenedor.
# ─────────────────────────────────────────────────────────────
set -e

CERT_DIR="/data/certs"
CA_KEY="$CERT_DIR/ca.key"
CA_CERT="$CERT_DIR/ca.crt"
SRV_KEY="$CERT_DIR/server.key"
SRV_CERT="$CERT_DIR/server.crt"
SRV_CSR="$CERT_DIR/server.csr"
SRV_EXT="$CERT_DIR/server.ext"

mkdir -p "$CERT_DIR"

if [ ! -f "$SRV_CERT" ] || [ ! -f "$SRV_KEY" ]; then
    echo "[TLS] Generando certificados por primera vez..."

    # 1. CA raíz (válida 10 años)
    openssl genrsa -out "$CA_KEY" 4096 2>/dev/null
    openssl req -new -x509 -days 3650 -key "$CA_KEY" -out "$CA_CERT" \
        -subj "/C=ES/O=AuditorIPs-LocalCA/CN=AuditorIPs Local CA" 2>/dev/null

    # 2. Clave del servidor
    openssl genrsa -out "$SRV_KEY" 2048 2>/dev/null

    # 3. CSR
    openssl req -new -key "$SRV_KEY" -out "$SRV_CSR" \
        -subj "/C=ES/O=AuditorIPs/CN=auditor.local" 2>/dev/null

    # 4. SAN extension — incluye IPs comunes de LAN + localhost
    #    Si SCAN_CIDR=192.168.1.0/24, el servidor probablemente sea .1.x
    #    Se añaden rangos amplios para cubrir cualquier IP de LAN típica
    cat > "$SRV_EXT" << 'EXTEOF'
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage=digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=@alt_names

[alt_names]
IP.1=127.0.0.1
IP.2=192.168.1.1
IP.3=192.168.1.2
IP.4=192.168.1.10
IP.5=192.168.1.20
IP.6=192.168.1.30
IP.7=192.168.1.40
IP.8=192.168.1.50
IP.9=192.168.1.100
IP.10=192.168.1.101
IP.11=192.168.1.200
IP.12=192.168.1.210
IP.13=192.168.1.252
IP.14=192.168.1.253
IP.15=192.168.1.254
IP.16=10.0.0.1
IP.17=10.0.0.2
IP.18=10.0.0.10
DNS.1=localhost
DNS.2=auditor.local
EXTEOF

    # Añadir SERVER_IP del entorno si está definida
    if [ -n "$SERVER_IP" ]; then
        echo "IP.99=$SERVER_IP" >> "$SRV_EXT"
        echo "[TLS] Añadiendo IP del servidor: $SERVER_IP"
    fi

    # 5. Firmar con la CA local
    openssl x509 -req -days 3650 \
        -in "$SRV_CSR" \
        -CA "$CA_CERT" -CAkey "$CA_KEY" -CAcreateserial \
        -out "$SRV_CERT" \
        -extfile "$SRV_EXT" 2>/dev/null

    # Permisos seguros
    chmod 600 "$CA_KEY" "$SRV_KEY"
    chmod 644 "$CA_CERT" "$SRV_CERT"

    echo "[TLS] ✓ Certificados generados en $CERT_DIR"
    echo "[TLS]   CA raíz para Android: $CA_CERT"
    echo "[TLS]   Copia ca.crt al móvil e instálala en: Ajustes → Seguridad → Instalar certificado"
else
    echo "[TLS] Certificados ya existentes, reutilizando."
fi

# Arrancar Uvicorn con TLS
exec python -m uvicorn main:app \
    --host 0.0.0.0 \
    --port 8088 \
    --ssl-keyfile  "$SRV_KEY" \
    --ssl-certfile "$SRV_CERT"
