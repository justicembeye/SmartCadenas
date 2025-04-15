"""
Script de test pour l'API SmartCadenas
Permet de vérifier le bon fonctionnement des endpoints principaux
"""

import requests

# Configuration
BASE_URL = "http://localhost:5000/api"
TEST_AGENT = "test_agent"


def test_generate_code():
    """Teste la génération d'un nouveau code"""
    print("\n🔑 Test de génération de code...")

    response = requests.post(f"{BASE_URL}/code")

    if response.status_code == 201:
        data = response.json()
        print(f"✅ Code généré: {data['code']}")
        print(f"✅ Valide jusqu'à: {data['valid_until']}")
        return data['code']
    else:
        print(f"❌ Échec de génération du code: {response.status_code}")
        print(response.text)
        return None


def test_verify_code(code):
    """Teste la vérification d'un code valide"""
    print("\n🔍 Test de vérification du code...")

    response = requests.get(f"{BASE_URL}/code")

    if response.status_code == 200:
        data = response.json()
        if data['valid'] and data['code'] == code:
            print(f"✅ Code valide: {data['code']}")
            print(f"✅ Temps restant: {data['remaining_time']} secondes")
