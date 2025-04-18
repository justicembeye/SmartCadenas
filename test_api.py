"""
Script de test complet pour l'API SmartCadenas

Objectif : vérifier que tous les endpoints fonctionnent correctement
"""

import requests
import time
from datetime import datetime

BASE_URL = "http://localhost:5000/api"
TEST_AGENT = "TestBot"

def test_generate_code():
    print("\n🔑 [1] Génération d'un code...")
    response = requests.post(f"{BASE_URL}/code")
    assert response.status_code == 201, "Échec génération code"
    data = response.json()
    print(f"✅ Code généré: {data['code']}")
    return data['code']

def test_get_code(code):
    print("\n🔍 [2] Récupération du code actuel...")
    response = requests.get(f"{BASE_URL}/code")
    assert response.status_code == 200, "Échec récupération code"
    data = response.json()
    assert data['valid'] and data['code'] == code, "Code invalide ou incorrect"
    print(f"✅ Code valide : {data['code']}, temps restant : {data['remaining_time']}s")

def test_log_access_success(code):
    print("\n🚪 [3] Simulation accès avec code correct...")
    payload = {
        "event": "door_open",
        "code": code,
        "agent": TEST_AGENT
    }
    response = requests.post(f"{BASE_URL}/access", json=payload)
    assert response.status_code == 201, "Erreur journalisation accès"
    data = response.json()
    assert data['event_status'] == "success", "Accès non reconnu comme valide"
    print("✅ Accès journalisé avec succès")

def test_log_access_close(code):
    print("\n🔒 [4] Simulation de fermeture de porte...")
    payload = {
        "event": "door_close",
        "code": code,
        "agent": TEST_AGENT
    }
    response = requests.post(f"{BASE_URL}/access", json=payload)
    assert response.status_code == 201, "Erreur fermeture"
    print("✅ Fermeture journalisée")

def test_log_access_fail():
    print("\n❌ [5] Simulation de tentative d'accès avec mauvais code...")
    payload = {
        "event": "door_open",
        "code": "0000",
        "agent": TEST_AGENT
    }
    response = requests.post(f"{BASE_URL}/access", json=payload)
    data = response.json()
    assert response.status_code == 201
    assert data['event_status'] == "failed"
    print("✅ Tentative échouée détectée et journalisée")

def test_create_alert():
    print("\n🚨 [6] Création d'une alerte manuelle...")
    payload = {
        "type": "test_alert",
        "message": "Alerte déclenchée pour test",
        "severity": "high"
    }
    response = requests.post(f"{BASE_URL}/alert", json=payload)
    assert response.status_code == 201
    print("✅ Alerte enregistrée")

def test_get_logs():
    print("\n📋 [7] Récupération des logs...")
    response = requests.get(f"{BASE_URL}/logs?page=1&per_page=5")
    assert response.status_code == 200
    data = response.json()
    assert "logs" in data
    print(f"✅ {len(data['logs'])} log(s) récupéré(s)")

def test_get_alerts():
    print("\n⚠️ [8] Récupération des alertes...")
    response = requests.get(f"{BASE_URL}/alerts")
    assert response.status_code == 200
    data = response.json()
    assert "alerts" in data
    print(f"✅ {len(data['alerts'])} alerte(s) non résolue(s) trouvée(s)")
    return data['alerts']

def test_resolve_alert(index):
    print(f"\n✅ [9] Résolution de l'alerte {index}...")
    response = requests.post(f"{BASE_URL}/alert/{index}/resolve")
    assert response.status_code == 200
    print("✅ Alerte résolue avec succès")

def run_all_tests():
    print("🚀 Lancement des tests complets SmartCadenas...\n")
    code = test_generate_code()
    time.sleep(1)
    test_get_code(code)
    test_log_access_success(code)
    test_log_access_close(code)
    test_log_access_fail()
    test_create_alert()
    test_get_logs()
    alerts = test_get_alerts()
    if alerts:
        test_resolve_alert(0)
    else:
        print("ℹ️ Aucun index d'alerte à résoudre.")
    print("\n✅ ✅ ✅ Tous les tests ont été exécutés avec succès.")

if __name__ == "__main__":
    run_all_tests()
