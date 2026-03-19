#!/usr/bin/env python3
import urllib.request
import json
import time
import urllib.error
import sys

# --- CONFIGURACIÓN ---
# RECUERDA: Genera una nueva KEY, la anterior ya no es segura.
KEY = 'AIzaSyDCNba9w9Mw4_6e5n1v5FOvXe5ATp1B54c' 
MODEL = "gemini-2.0-flash"
URL = f'https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={KEY}'

def probar_api():
    payload = json.dumps({
        'contents': [{'parts': [{'text': 'Hola, responde con la palabra "TEST" y nada más.'}]}], 
        'generationConfig': {'maxOutputTokens': 10}
    }).encode('utf-8')

    intentos_max = 3
    espera = 5  # Segundos iniciales de espera si hay error 429

    print(f"--- Iniciando prueba de API Gemini ({MODEL}) ---")
    
    for i in range(1, intentos_max + 1):
        print(f"[*] Intento {i}/{intentos_max}: Enviando solicitud...")
        
        req = urllib.request.Request(
            URL, 
            data=payload, 
            headers={'Content-Type': 'application/json'}
        )

        try:
            with urllib.request.urlopen(req, timeout=15) as response:
                status = response.getcode()
                raw_data = response.read().decode('utf-8')
                data = json.loads(raw_data)
                
                print(f"[OK] Respuesta recibida (Código {status})")
                texto = data['candidates'][0]['content']['parts'][0]['text']
                print(f"[RESULTADO]: {texto.strip()}")
                return # Finaliza con éxito

        except urllib.error.HTTPError as e:
            cuerpo_error = e.read().decode('utf-8')
            if e.code == 429:
                print(f"[!] ERROR 429: Demasiadas peticiones (Quota Exceeded).")
                if i < intentos_max:
                    print(f"[...] Aplicando pausa de {espera} segundos antes de reintentar...")
                    time.sleep(espera)
                    espera *= 2 # Backoff exponencial
                else:
                    print("[X] Se agotaron los reintentos por cuota.")
            else:
                print(f"[X] ERROR HTTP {e.code}: {cuerpo_error}")
                break
        
        except Exception as e:
            print(f"[X] ERROR INESPERADO: {str(e)}")
            break

    print("--- Fin de la ejecución ---")

if __name__ == "__main__":
    probar_api()