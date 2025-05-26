"""
Module de gestion d'API pour l'application SmartCadenas.

Ce module fournit une API Flask pour la gestion des codes d'accès,
des logs de sécurité et des alertes pour un système de cadenas intelligent.
"""

import json
import logging
import os
import re
import secrets
import string
from datetime import datetime, timedelta
from typing import Any, Dict, Tuple, Union

from dotenv import load_dotenv
from flask import Flask, render_template, request, jsonify
from flask_cors import CORS
from flask_restful import Api, Resource

# Charger les variables d'environnement
load_dotenv()

# Configuration du logger
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[logging.FileHandler('app.log'), logging.StreamHandler()]
)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)
app.config['JSON_SORT_KEYS'] = False
app.secret_key = os.getenv('SECRET_KEY', secrets.token_hex(16))
api = Api(app)

app.jinja_env.globals.update(max=max, min=min)

DATA_FILE = 'codes.json'
MAX_LOGS = int(os.getenv('MAX_LOGS', 1000))
MAX_ALERTS = int(os.getenv('MAX_ALERTS', 100))
DEFAULT_CODE_LENGTH = 4
DEFAULT_CODE_VALIDITY = 300
DEFAULT_MAX_ATTEMPTS = 3


def get_default_data() -> Dict[str, Any]:
    return {
        "settings": {
            "code_length": int(os.getenv('CODE_LENGTH', DEFAULT_CODE_LENGTH)),
            "code_validity": int(os.getenv('CODE_VALIDITY', DEFAULT_CODE_VALIDITY)),
            "max_attempts": int(os.getenv('MAX_ATTEMPTS', DEFAULT_MAX_ATTEMPTS))
        },
        "current_code": {}, "access_logs": [], "alerts": [],
        "agents": {"default": {"name": "Technicien", "permissions": ["basic_access"]}},
        "failed_attempts": {"count": 0, "last_reset": datetime.now().isoformat(), "attempts": []}
    }

def sanitize_input(input_str: Union[str, Any]) -> str:
    if not isinstance(input_str, str): return ""
    return re.sub(r'[<>\'";`]', '', input_str)

def load_data() -> Dict[str, Any]:
    if not os.path.exists(DATA_FILE):
        default_data = get_default_data()
        with open(DATA_FILE, 'w', encoding='utf-8') as file:
            json.dump(default_data, file, indent=2, ensure_ascii=False)
        return default_data
    try:
        with open(DATA_FILE, 'r', encoding='utf-8') as file: data = json.load(file)
        if not isinstance(data, dict): raise ValueError("Format JSON invalide")
        default_data_structure = get_default_data()
        for key, value in default_data_structure.items():
            if key not in data: data[key] = value
            elif key == "settings" and isinstance(value, dict):
                for sub_key, sub_value in value.items():
                    if sub_key not in data[key]: data[key][sub_key] = sub_value
        return data
    except (json.JSONDecodeError, ValueError) as e:
        logger.error(f"Erreur chargement données: {str(e)}")
        backup_file = f"{DATA_FILE}.bak.{datetime.now().strftime('%Y%m%d%H%M%S')}"
        current_data_content = {}
        if os.path.exists(DATA_FILE):
            try:
                with open(DATA_FILE, 'r', encoding='utf-8') as f_read: current_data_content = json.load(f_read)
            except: pass # pylint: disable=bare-except
        try:
            with open(backup_file, 'w', encoding='utf-8') as file_backup:
                json.dump(current_data_content if current_data_content else {"error_loading": True}, file_backup, indent=2, ensure_ascii=False)
            logger.info(f"Sauvegarde créée: {backup_file}")
        except Exception as backup_error: logger.error(f"Erreur sauvegarde: {str(backup_error)}")
        default_data_on_error = get_default_data()
        with open(DATA_FILE, 'w', encoding='utf-8') as file_reset:
            json.dump(default_data_on_error, file_reset, indent=2, ensure_ascii=False)
        return default_data_on_error

def save_data(data: Dict[str, Any]) -> bool:
    try:
        for collection in ["access_logs", "alerts"]:
            if collection in data and len(data[collection]) > (MAX_LOGS if collection == "access_logs" else MAX_ALERTS):
                data[collection] = sorted(data[collection], key=lambda x: x.get('timestamp', ''), reverse=True)[:MAX_LOGS if collection == "access_logs" else MAX_ALERTS]
        with open(DATA_FILE, 'w', encoding='utf-8') as file:
            json.dump(data, file, indent=2, ensure_ascii=False)
        return True
    except Exception as e:
        logger.error(f"Erreur sauvegarde données: {str(e)}")
        return False

def generate_code(length: int = DEFAULT_CODE_LENGTH) -> str:
    if not isinstance(length, int) or not 4 <= length <= 10: length = DEFAULT_CODE_LENGTH
    return ''.join(secrets.choice(string.digits) for _ in range(length))

def is_code_valid(code_data: Dict[str, Any]) -> bool:
    if not code_data or not code_data.get("valid_until"): return False
    try: return datetime.now() < datetime.fromisoformat(code_data["valid_until"])
    except ValueError: return False

@app.route('/api/state')
def get_state():
    data = load_data()
    return jsonify({
        'current_code': data.get('current_code'),
        'access_logs': data.get('access_logs', [])[-10:],
        'alerts': [a for a in data.get('alerts', []) if not a.get('resolved')]
    })

def create_security_alert(storage: Dict[str, Any], alert_type: str, message: str, severity: str = "medium") -> Dict[str, Any]:
    valid_severities = ["low", "medium", "high", "critical"]
    severity = severity if severity in valid_severities else "medium"
    alert = {"type": sanitize_input(alert_type), "message": sanitize_input(message), "severity": severity,
             "timestamp": datetime.now().isoformat(), "resolved": False, "_index": len(storage.get("alerts", []))}
    storage.setdefault("alerts", []).append(alert)
    return alert

def increment_failed_attempt(storage: Dict[str, Any]) -> int:
    if "failed_attempts" not in storage:
        storage["failed_attempts"] = {"count": 0, "last_reset": datetime.now().isoformat(), "attempts": []}
    current_time = datetime.now()
    ip_address = request.remote_addr if request else "unknown"
    user_agent = request.headers.get('User-Agent', 'unknown') if request else "unknown"
    storage["failed_attempts"]["count"] += 1
    storage["failed_attempts"]["attempts"].append({"timestamp": current_time.isoformat(), "ip_address": ip_address, "user_agent": user_agent[:200]})
    cutoff_time = (current_time - timedelta(minutes=15)).isoformat()
    storage["failed_attempts"]["attempts"] = [a for a in storage["failed_attempts"]["attempts"] if a["timestamp"] > cutoff_time]
    storage["failed_attempts"]["count"] = len(storage["failed_attempts"]["attempts"])
    max_attempts = storage.get("settings", {}).get("max_attempts", DEFAULT_MAX_ATTEMPTS)
    if storage["failed_attempts"]["count"] >= max_attempts:
        create_security_alert(storage, "multiple_failed_attempts", f"{storage['failed_attempts']['count']} tentatives échouées depuis {ip_address}", "high")
        storage["failed_attempts"] = {"count": 0, "last_reset": datetime.now().isoformat(), "attempts": []}
    return storage["failed_attempts"]["count"]

@app.template_filter('datetimeformat')
def datetimeformat(value: Union[str, datetime], fmt: str = '%d/%m/%Y %H:%M:%S') -> str:
    if not value: return ""
    if isinstance(value, str):
        try: value = datetime.fromisoformat(value)
        except ValueError: return value
    return value.strftime(fmt)

@app.errorhandler(404)
def page_not_found(_) -> Tuple[str, int]: return render_template('error.html', error="Page non trouvée", code=404), 404
@app.errorhandler(500)
def server_error(_) -> Tuple[str, int]: return render_template('error.html', error="Erreur serveur", code=500), 500

@app.route('/')
def dashboard() -> Union[str, Tuple[str, int]]:
    try:
        data = load_data()
        settings = data.get("settings", get_default_data()["settings"])
        logs_page = max(1, request.args.get('logs_page', 1, type=int))
        alerts_page = max(1, request.args.get('alerts_page', 1, type=int))
        per_page = 5
        logs = sorted(data.get("access_logs", []), key=lambda x: x.get('timestamp', ''), reverse=True)
        total_logs = len(logs)
        logs_to_show = logs[(logs_page - 1) * per_page: logs_page * per_page]
        alerts = [a for a in data.get("alerts", []) if not a.get("resolved", False)]
        alerts = sorted(alerts, key=lambda x: x.get('timestamp', ''), reverse=True)
        total_alerts = len(alerts)
        alerts_to_show = alerts[(alerts_page - 1) * per_page: alerts_page * per_page]
        failed_attempts = data.get("failed_attempts", {"count": 0})
        failed_count = failed_attempts.get("count", 0)
        max_attempts = settings.get("max_attempts", DEFAULT_MAX_ATTEMPTS)
        progress = (failed_count / max_attempts) * 100 if max_attempts > 0 else 0
        security_level = "danger" if failed_count >= max_attempts else "warning" if failed_count > 0 else "success"
        failure_reasons = {}
        recent_failed_logs = [log for log in logs if log.get("status") == "failed"][:20]
        for log in recent_failed_logs:
            reason = log.get("reason", "unknown")
            failure_reasons[reason] = failure_reasons.get(reason, 0) + 1
        return render_template('dashboard.html', is_code_valid=is_code_valid, now=datetime.now(),
                               current_code=data.get("current_code"), logs=logs_to_show, alerts=alerts_to_show,
                               total_logs=total_logs, total_alerts=total_alerts, logs_page=logs_page,
                               logs_pages=max(1, (total_logs + per_page - 1) // per_page), alerts_page=alerts_page,
                               alerts_pages=max(1, (total_alerts + per_page - 1) // per_page),
                               failed_attempts_count=failed_count, max_attempts=max_attempts,
                               security_level=security_level, progress_percentage=progress,
                               failure_reasons=failure_reasons, settings=settings)
    except Exception as e:
        logger.error(f"Erreur dashboard: {str(e)}")
        return render_template('error.html', error="Erreur dashboard", code=500), 500

class CodeResource(Resource):
    def get(self) -> Dict[str, Any]:
        try:
            data = load_data()
            current_code = data.get("current_code", {})
            if not current_code or not current_code.get("value"):
                return {"valid": False, "code": None, "remaining_time": 0, "reason": "no_code_generated"}
            code_valid = is_code_valid(current_code)
            remaining_time = 0; reason = None
            if code_valid:
                valid_until = datetime.fromisoformat(current_code["valid_until"])
                remaining_time = max(0, int((valid_until - datetime.now()).total_seconds()))
            else: reason = "code_expired"
            if current_code.get("used", False): code_valid = False; reason = "code_already_used"
            return {"valid": code_valid, "code": current_code["value"], "generated_at": current_code.get("generated_at"),
                    "valid_until": current_code.get("valid_until"), "used": current_code.get("used", False),
                    "remaining_time": remaining_time, "reason": reason}
        except Exception as e: logger.error(f"Erreur GET CodeResource: {str(e)}"); return {"error": "Erreur serveur"}, 500

    def post(self) -> Tuple[Dict[str, Any], int]:
        try:
            data = load_data(); settings = data.get("settings", {})
            code_length = max(4, min(10, settings.get("code_length", DEFAULT_CODE_LENGTH)))
            code_validity = max(60, settings.get("code_validity", DEFAULT_CODE_VALIDITY))
            new_code = generate_code(code_length); generated_at = datetime.now()
            valid_until = generated_at + timedelta(seconds=code_validity)
            data["current_code"] = {"value": new_code, "generated_at": generated_at.isoformat(),
                                   "valid_until": valid_until.isoformat(), "used": False, "used_for_entry": False}
            if not save_data(data): return {"error": "Erreur sauvegarde"}, 500
            logger.info(f"API: Nouveau code généré: {new_code}")
            return {"code": new_code, "generated_at": generated_at.isoformat(), "valid_until": valid_until.isoformat()}, 201
        except Exception as e: logger.error(f"Erreur POST CodeResource: {str(e)}"); return {"error": "Erreur serveur"}, 500


class AccessResource(Resource):
    def post(self) -> Tuple[Dict[str, Any], int]:
        try:
            req_data = request.json
            if not req_data or not isinstance(req_data, dict): return {"error": "Données invalides"}, 400

            event = req_data.get('event')
            code = req_data.get('code')
            agent = sanitize_input(req_data.get('agent', 'unknown'))

            if not event:
                return {"error": "Champ 'event' manquant"}, 400

            if event not in ["door_open", "door_close"]:
                return {"error": "Événement non reconnu"}, 400

            # Charger les données, y compris les settings
            storage = load_data()  # load_data() charge tout le fichier codes.json
            settings = storage.get("settings", get_default_data().get("settings", {}))  # Récupérer les settings

            # Si l'événement est 'door_open', le code est obligatoire et ne doit pas être vide.
            if event == "door_open" and (code is None or code == ""):
                return {"error": "Champ 'code' manquant ou vide pour l'événement door_open"}, 400

            if code is None:
                return {"error": "Champ 'code' manquant"}, 400

            # Vérification de la longueur et du format pour les codes
            placeholders_autorises = ["_LBE_"]
            expected_code_length = settings.get("code_length", DEFAULT_CODE_LENGTH)

            if event == "door_open":  # Validation stricte pour les codes d'ouverture
                if not code.isdigit() or len(code) != expected_code_length:
                    logger.warning(
                        f"API Access: Code '{code}' au format invalide pour door_open (attendu: {expected_code_length} chiffres).")
                    return {"error": "Format de code invalide pour ouverture"}, 400
            elif code != "" and code not in placeholders_autorises:  # Pour door_close avec un code numérique
                if not code.isdigit() or len(
                        code) != expected_code_length:  # Si ce n'est pas un placeholder ni vide, il doit être valide
                    # Si le code pour un door_close (qui n'est pas un placeholder ou vide)
                    # ne correspond pas au format attendu, on peut le logger mais potentiellement le laisser passer
                    # car le but principal est de logger la fermeture.
                    # Ou on peut le rejeter. Pour l'instant, soyons un peu plus souple pour les codes de fermeture non placeholder.
                    # Cependant, la logique _handle_door_close vérifiera s'il correspond au current_code.
                    # Pour être cohérent, on peut aussi appliquer une validation ici.
                    # Décidons pour l'instant de ne valider strictement que les codes pour 'door_open'.
                    # La validation de longueur > 10 est toujours une bonne idée générale.
                    if len(code) > 10:  # Simple vérification de longueur excessive
                        logger.warning(f"API Access: Code '{code}' trop long reçu pour door_close.")
                        return {"error": "Format de code invalide (trop long)"}, 400

            timestamp = datetime.now().isoformat();
            ip_address = request.remote_addr
            log_entry = {"event": event, "code_used": code, "agent": agent, "timestamp": timestamp,
                         "ip_address": ip_address, "status": "pending"}

            if event == "door_close":
                self._handle_door_close(storage, code, log_entry)
            elif event == "door_open":
                self._handle_door_open(storage, code, log_entry, settings)  # Passer settings ici

            storage.setdefault("access_logs", []).append(log_entry)
            if not save_data(storage):
                logger.error("API Access: Échec sauvegarde après traitement accès.")
                return {"error": "Erreur de sauvegarde interne"}, 500

            logger.info(
                f"API Access: Événement '{event}' traité pour code '{code}'. Statut: {log_entry['status']}, Raison: {log_entry.get('reason')}")
            return {"status": "logged", "event_status": log_entry["status"], "reason": log_entry.get("reason")}, 201
        except Exception as e:
            logger.error(f"Erreur POST AccessResource: {str(e)}"); return {"error": "Erreur serveur"}, 500

    def _handle_door_close(self, storage: Dict[str, Any], code: str, log_entry: Dict[str, Any]) -> None:
        # ... (contenu de _handle_door_close comme dans ma réponse précédente, il n'utilise pas settings) ...
        current_code_data = storage.get("current_code", {})
        if code == "":
            log_entry.update(
                {"status": "success", "reason": "Sortie par bouton (sans code d'entrée préalable valide) journalisée"})
        elif code == "_LBE_":
            log_entry.update({"status": "success", "reason": "Sortie par bouton (après entrée valide) journalisée"})
        elif current_code_data.get("value") == code and current_code_data.get("used_for_entry", False):
            storage["current_code"]["used"] = True
            storage["current_code"]["used_for_entry"] = False
            log_entry.update({"status": "success", "reason": "Code invalidé après cycle d'accès complet (fermeture)"})
        elif current_code_data.get("value") == code and not current_code_data.get("used_for_entry", False):
            log_entry.update({"status": "warning",
                              "reason": "Fermeture avec code actuel, mais pas utilisé pour entrée récente ou déjà invalidé."})
        else:
            log_entry.update({"status": "warning",
                              "reason": "Code non reconnu ou non applicable pour l'événement de sortie/fermeture"})

    # MODIFIÉ: _handle_door_open a besoin des settings pour la longueur du code attendue
    def _handle_door_open(self, storage: Dict[str, Any], code: str, log_entry: Dict[str, Any],
                          settings: Dict[str, Any]) -> None:
        current_code_data = storage.get("current_code", {})
        # expected_code_length est maintenant récupéré via settings passés en argument
        expected_code_length = settings.get("code_length", DEFAULT_CODE_LENGTH)

        # La validation du format (numérique, longueur) a été remontée dans la méthode post()
        # On peut la garder ici aussi pour une double vérification si on le souhaite, mais c'est redondant.
        # Assumons que le code arrivant ici a déjà passé la validation de format de base.

        if current_code_data.get("value") == code:
            if is_code_valid(current_code_data):
                if not current_code_data.get("used", False) and not current_code_data.get("used_for_entry", False):
                    log_entry["status"] = "success";
                    storage["current_code"]["used_for_entry"] = True
                else:
                    log_entry["status"] = "failed";
                    log_entry["reason"] = "code_already_used_for_entry_or_exit"
            else:
                log_entry["status"] = "failed";
                log_entry["reason"] = "code_expired"
                increment_failed_attempt(storage)
        else:
            log_entry["status"] = "failed";
            log_entry["reason"] = "code_incorrect"
            increment_failed_attempt(storage)

class LogsResource(Resource):
    def get(self) -> Dict[str, Any]:
        try:
            data = load_data(); page = max(1, request.args.get('page', 1, type=int))
            per_page = min(50, max(1, request.args.get('per_page', 10, type=int)))
            logs = sorted(data.get("access_logs", []), key=lambda x: x.get('timestamp', ''), reverse=True)
            total = len(logs); start = (page - 1) * per_page
            return {"logs": logs[start:start + per_page], "pagination": {"total": total, "page": page, "per_page": per_page, "pages": max(1, (total + per_page - 1) // per_page)}}
        except Exception as e: logger.error(f"Erreur GET LogsResource: {str(e)}"); return {"error": "Erreur serveur"}, 500

class AlertResource(Resource):
    def post(self) -> Tuple[Dict[str, Any], int]:
        try:
            req_data = request.json
            if not req_data or not isinstance(req_data, dict): return {"error": "Données invalides"}, 400
            alert_type = req_data.get('type'); message = req_data.get('message'); severity = req_data.get('severity', 'medium')
            if not alert_type or not message: return {"error": "Champs manquants"}, 400
            storage = load_data(); alert = create_security_alert(storage, alert_type, message, severity)
            if not save_data(storage): return {"error": "Erreur sauvegarde"}, 500
            logger.info(f"API Alert: Alerte créée - Type: {alert_type}, Sévérité: {severity}")
            return {"status": "alert_created", "alert_id": alert.get("_index"), "timestamp": alert.get("timestamp")}, 201
        except Exception as e: logger.error(f"Erreur POST AlertResource: {str(e)}"); return {"error": "Erreur serveur"}, 500

class AlertResolveResource(Resource):
    def post(self, index: int) -> Tuple[Dict[str, Any], int]:
        try:
            data = load_data(); #alerts = data.get("alerts", []) # Non utilisé directement
            if not isinstance(index, int) or index < 0: return {"error": "Index invalide"}, 400
            alert_to_resolve = None; original_list_index = -1
            for i, alert_item in enumerate(data.get("alerts",[])): # Utiliser data.get pour être sûr
                if alert_item.get("_index") == index: alert_to_resolve = alert_item; original_list_index = i; break
            if not alert_to_resolve: return {"error": "Alerte non trouvée"}, 404
            if alert_to_resolve.get("resolved", False): return {"error": "Alerte déjà résolue"}, 400
            data["alerts"][original_list_index].update({"resolved": True, "resolved_at": datetime.now().isoformat(), "resolved_by": request.remote_addr})
            if not save_data(data): return {"error": "Erreur sauvegarde"}, 500
            logger.info(f"API Alert: Alerte {index} marquée comme résolue.")
            return {"status": "alert_resolved", "alert_index": index, "resolved_at": data["alerts"][original_list_index]["resolved_at"]}
        except Exception as e: logger.error(f"Erreur POST AlertResolveResource for index {index}: {str(e)}"); return {"error": "Erreur serveur"}, 500

class AlertsResource(Resource):
    def get(self) -> Dict[str, Any]:
        try:
            data = load_data(); page = max(1, request.args.get('page', 1, type=int))
            per_page = min(50, max(1, request.args.get('per_page', 10, type=int)))
            show_resolved = request.args.get('show_resolved', 'false').lower() == 'true'
            alerts_source = data.get("alerts", []); filtered_alerts = []
            if show_resolved: filtered_alerts = alerts_source
            else:
                for alert_item in alerts_source:
                    if not alert_item.get("resolved", False): filtered_alerts.append(alert_item)
            alerts = sorted(filtered_alerts, key=lambda x: x.get('timestamp', ''), reverse=True)
            total = len(alerts); start = (page - 1) * per_page
            return {"alerts": alerts[start:start + per_page], "pagination": {"total": total, "page": page, "per_page": per_page, "pages": max(1, (total + per_page - 1) // per_page)}}
        except Exception as e: logger.error(f"Erreur GET AlertsResource: {str(e)}"); return {"error": "Erreur serveur"}, 500

class SettingsResource(Resource):
    def get(self) -> Dict[str, Any]:
        try:
            data = load_data()
            default_settings_values = get_default_data().get("settings", {})
            current_settings = data.get("settings", default_settings_values)
            settings_to_return = {
                "code_length": current_settings.get("code_length", DEFAULT_CODE_LENGTH),
                "code_validity": current_settings.get("code_validity", DEFAULT_CODE_VALIDITY),
                "max_attempts": current_settings.get("max_attempts", DEFAULT_MAX_ATTEMPTS)
            }
            logger.info(f"API: Envoi des paramètres: {settings_to_return}")
            return settings_to_return, 200
        except Exception as e:
            logger.error(f"Erreur GET SettingsResource: {str(e)}")
            return {"error": "Erreur serveur lors de la récupération des paramètres"}, 500

api.add_resource(CodeResource, '/api/code')
api.add_resource(AccessResource, '/api/access')
api.add_resource(LogsResource, '/api/logs')
api.add_resource(AlertResource, '/api/alert')
api.add_resource(AlertResolveResource, '/api/alert/<int:index>/resolve')
api.add_resource(AlertsResource, '/api/alerts')
api.add_resource(SettingsResource, '/api/settings')

if __name__ == '__main__':
    api_host = os.getenv('API_HOST', '0.0.0.0')
    api_port = int(os.getenv('API_PORT', 5000))
    if not os.path.exists(DATA_FILE):
        logger.info(f"Fichier {DATA_FILE} n'existe pas. Création avec données par défaut.")
        with open(DATA_FILE, 'w', encoding='utf-8') as f: json.dump(get_default_data(), f, indent=2, ensure_ascii=False)
        logger.info(f"Fichier {DATA_FILE} créé.")
    else:
        logger.info(f"Vérification et mise à jour structure de {DATA_FILE}.")
        loaded_data = load_data(); save_data(loaded_data)
    logger.info(f"Démarrage serveur SmartCadenas API sur {api_host}:{api_port}")
    app.run(host=api_host, port=api_port, debug=os.getenv('FLASK_ENV') == 'development')