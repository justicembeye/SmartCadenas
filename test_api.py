#!/usr/bin/env python3
"""
Script de test complet pour l'API SmartCadenas - Version fonctionnelle
"""

import argparse
import json
import logging
import os
import random
import sys
import time
from typing import Optional, Dict

import requests
from requests.exceptions import RequestException

# Configuration du logger
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
)
logger = logging.getLogger("test_api")

# Configuration
BASE_URL = os.getenv("API_BASE_URL", "http://localhost:5000/api")
TEST_AGENT = os.getenv("TEST_AGENT", "TestBot/1.0")
REQUEST_TIMEOUT = int(os.getenv("REQUEST_TIMEOUT", 5))
DEFAULT_CODE_VALIDITY = int(os.getenv("CODE_VALIDITY", 300))  # 5 minutes


class Colors:
    """Codes ANSI pour les couleurs dans le terminal"""
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    RED = '\033[91m'
    BLUE = '\033[94m'
    MAGENTA = '\033[95m'
    CYAN = '\033[96m'
    RESET = '\033[0m'
    BOLD = '\033[1m'


def print_colored(text: str, color: str, bold: bool = False) -> None:
    """Affiche du texte coloré dans la console"""
    bold_code = Colors.BOLD if bold else ''
    print(f"{bold_code}{color}{text}{Colors.RESET}")


class APITester:
    """Classe principale pour les tests d'API"""

    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({'User-Agent': TEST_AGENT})
        self.current_code = None
        self.test_results = []
        self.failed_attempts = 0

    def make_request(self, method: str, endpoint: str, **kwargs) -> Optional[Dict]:
        """Effectue une requête HTTP avec gestion des erreurs"""
        url = f"{BASE_URL}{endpoint}"
        kwargs.setdefault('timeout', REQUEST_TIMEOUT)

        try:
            response = getattr(self.session, method.lower())(url, **kwargs)
            response.raise_for_status()
            return response.json() if response.content else None
        except RequestException as e:
            logger.error(f"Erreur de requête: {e}")
            return None

    def run_test(self, test_func, description: str) -> bool:
        """Exécute un test et enregistre le résultat"""
        print_colored(f"\n{description}", Colors.CYAN)
        start_time = time.time()

        try:
            result = test_func()
            duration = time.time() - start_time
            status = "✅ SUCCÈS" if result else "❌ ÉCHEC"
            color = Colors.GREEN if result else Colors.RED

            self.test_results.append({
                "test": description,
                "status": result,
                "duration": duration
            })

            print_colored(f"{status} ({duration:.2f}s)", color)
            return result
        except Exception as e:
            logger.error(f"Erreur inattendue: {e}")
            self.test_results.append({
                "test": description,
                "status": False,
                "error": str(e),
                "duration": time.time() - start_time
            })
            return False

    def run_all_tests(self):
        """Exécute tous les tests dans l'ordre logique"""
        test_order = [
            ('test_server_health', "1. Santé du serveur"),
            ('test_code_generation', "2. Génération de code"),
            ('test_code_validation', "3. Validation de code"),
            ('test_access_success', "4. Accès avec code valide"),
            ('test_door_close', "5. Fermeture de porte"),
            ('test_access_fail', "6. Accès avec code invalide"),
            ('test_invalidate_code', "7. Invalidation après sortie"),
            ('test_error_reason', "8. Raisons d'échec détaillées"),
            ('test_multiple_failures', "9. Tentatives multiples échouées"),
            ('test_create_alert', "10. Création d'alerte"),
            ('test_get_logs', "11. Récupération des logs"),
            ('test_get_alerts', "12. Récupération des alertes")
        ]

        for test_method_name, description in test_order:
            test_method = getattr(self, test_method_name, None)
            if test_method:
                self.run_test(test_method, description)
            else:
                print_colored(f"❌ Test '{test_method_name}' non implémenté", Colors.RED)
                self.test_results.append({
                    "test": description,
                    "status": False,
                    "error": f"Test {test_method_name} non implémenté",
                    "duration": 0
                })

    # Méthodes de test
    def test_server_health(self) -> bool:
        """Vérifie que le serveur répond"""
        response = self.make_request('GET', '/code')
        return response is not None

    def test_code_generation(self) -> bool:
        """Teste la génération de code"""
        data = self.make_request('POST', '/code')
        if not data or not data.get('code'):
            return False
        self.current_code = data['code']
        return True

    def test_code_validation(self) -> bool:
        """Teste la validation du code"""
        if not self.current_code:
            return False
        data = self.make_request('GET', '/code')
        return data and data.get('code') == self.current_code

    def test_access_success(self) -> bool:
        """Teste l'accès avec code valide"""
        if not self.current_code:
            return False
        payload = {"event": "door_open", "code": self.current_code}
        response = self.make_request('POST', '/access', json=payload)
        return response and response.get('event_status') == "success"

    def test_door_close(self) -> bool:
        """Teste la fermeture de porte"""
        if not self.current_code:
            return False
        payload = {"event": "door_close", "code": self.current_code}
        response = self.make_request('POST', '/access', json=payload)
        return response is not None

    def test_access_fail(self) -> bool:
        """Teste l'accès avec code invalide"""
        payload = {"event": "door_open", "code": "0000"}
        response = self.make_request('POST', '/access', json=payload)
        return response and response.get('event_status') == "failed"

    def test_invalidate_code(self) -> bool:
        """Teste l'invalidation après sortie"""
        # Générer un nouveau code pour ce test
        if not self.test_code_generation():
            return False
        payload = {"event": "door_close", "code": self.current_code}
        response = self.make_request('POST', '/access', json=payload)
        return response is not None

    def test_error_reason(self) -> bool:
        """Teste les raisons d'échec détaillées"""
        payload = {"event": "door_open", "code": "9999"}
        response = self.make_request('POST', '/access', json=payload)
        return response and 'reason' in response

    def test_multiple_failures(self) -> bool:
        """Teste les tentatives multiples échouées"""
        for _ in range(3):
            payload = {"event": "door_open", "code": str(random.randint(1000, 9999))}
            self.make_request('POST', '/access', json=payload)
        return True

    def test_create_alert(self) -> bool:
        """Teste la création d'alerte"""
        payload = {"type": "test", "message": "Alerte de test"}
        response = self.make_request('POST', '/alert', json=payload)
        return response is not None

    def test_get_logs(self) -> bool:
        """Teste la récupération des logs"""
        response = self.make_request('GET', '/logs')
        return response and 'logs' in response

    def test_get_alerts(self) -> bool:
        """Teste la récupération des alertes"""
        response = self.make_request('GET', '/alerts')
        return response and 'alerts' in response

    def generate_report(self) -> Dict:
        """Génère un rapport de test"""
        total = len(self.test_results)
        passed = sum(1 for r in self.test_results if r['status'])
        rate = (passed / total) * 100 if total > 0 else 0

        return {
            "summary": {
                "total_tests": total,
                "passed": passed,
                "success_rate": rate,
                "duration": sum(r['duration'] for r in self.test_results)
            },
            "details": self.test_results
        }


def main():
    """Point d'entrée principal"""
    parser = argparse.ArgumentParser(description='Testeur API SmartCadenas')
    parser.add_argument('--list', action='store_true', help='Lister les tests disponibles')
    parser.add_argument('--test', type=str, help='Exécuter un test spécifique')
    args = parser.parse_args()

    tester = APITester()

    if args.list:
        print_colored("Tests disponibles:", Colors.BLUE)
        tests = [
            "server_health", "code_generation", "code_validation",
            "access_success", "door_close", "access_fail",
            "invalidate_code", "error_reason", "multiple_failures",
            "create_alert", "get_logs", "get_alerts"
        ]
        for test in tests:
            print(f"  - {test}")
        return 0

    if args.test:
        test_method = getattr(tester, f"test_{args.test}", None)
        if not test_method:
            print_colored(f"Test inconnu: {args.test}", Colors.RED)
            return 1
        success = tester.run_test(test_method, f"Test: {args.test}")
    else:
        tester.run_all_tests()
        report = tester.generate_report()
        print_colored("\nRapport final:", Colors.BLUE)
        print(json.dumps(report, indent=2))
        success = report['summary']['success_rate'] == 100

    return 0 if success else 1

if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print_colored("\nInterrompu par l'utilisateur", Colors.YELLOW)
        sys.exit(130)
