/**
 * script.js - Fonctions JavaScript pour SmartCadenas
 * Gère le rafraîchissement des données, les interactions utilisateur et les animations
 */

// Configuration globale
const CONFIG = {
    refreshInterval: 10000,    // Intervalle de rafraîchissement en ms
    apiTimeout: 5000,          // Timeout pour les requêtes API en ms
    maxRetries: 3,             // Nombre maximal de tentatives en cas d'échec
    minRefreshDelay: 2000      // Délai minimum entre les rafraîchissements manuels
};

// État global
const state = {
    refreshTimer: null,
    isRefreshing: false,
    currentCode: null,
    connectionProblem: false,
    refreshCount: 0,
    lastRefreshTime: Date.now(),
    autoRefreshEnabled: true,
    apiFailCount: 0
};

// Sélecteurs DOM fréquemment utilisés
const DOM = {
    get refreshBtn() { return document.getElementById('refresh-btn'); },
    get generateBtn() { return document.getElementById('generate-btn'); },
    get dashboardContainer() { return document.querySelector('.dashboard-container'); },
    get codeElement() { return document.querySelector('.code-display'); },
    get statusElement() { return document.querySelector('.meta-item.status'); },
    get timeLeftDisplay() { return document.getElementById('time-left'); },
    get validUntilElement() { return document.querySelector('.meta-item.validity span:last-child'); },
    get updateTimeElement() { return document.getElementById('update-time'); },
    get logEntries() { return document.querySelector('.log-entries'); },
    get alertEntries() { return document.querySelector('.alert-entries'); },
    get alertCounter() { return document.querySelector('.badge.counter-badge.alert'); }
};

/**
 * Initialisation de l'application
 */
document.addEventListener('DOMContentLoaded', () => {
    setupEventHandlers();
    addCustomStyles();
    updateRemainingTime();
    startAutoRefresh();
    handleFooterLayout();
    console.log("SmartCadenas Dashboard initialisé");
});

// Gestion des événements
function setupEventHandlers() {
    if (DOM.refreshBtn) DOM.refreshBtn.addEventListener('click', manualRefresh);
    if (DOM.generateBtn) DOM.generateBtn.addEventListener('click', generateNewCode);

    // Gestionnaires délégués pour les éléments dynamiques
    document.addEventListener('click', e => {
        if (e.target.closest('.resolve-btn')) handleResolveAlert(e.target.closest('.resolve-btn'));

        // Nouveau code pour gérer les transitions de pagination
        const paginationLink = e.target.closest('.page-link');
        if (paginationLink) {
            const card = paginationLink.closest('.card');
            if (card) {
                // Appliquer une classe de transition uniquement sur la carte concernée
                const entriesContainer = card.querySelector('.log-entries, .alert-entries');
                if (entriesContainer) {
                    // Effet de transition plus doux
                    entriesContainer.style.opacity = '0.7';

                    // Rétablir après le chargement de page
                    setTimeout(() => {
                        entriesContainer.style.opacity = '1';
                    }, 300);
                }
            }
        }
    });
}

/**
 * Styles CSS personnalisés
 */
function addCustomStyles() {
    const style = document.createElement('style');
    style.textContent = `
        @keyframes rotating {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
        .rotating {
            animation: rotating 1s linear infinite;
        }
        .dashboard-container.refreshing {
            opacity: 0.9;
            transition: opacity 0.3s ease;
        }
        .code-display.expired-code {
            color: var(--danger);
            border-color: var(--danger);
        }
        .meta-item.status.expired {
            background-color: rgba(255, 0, 110, 0.1);
            color: var(--danger);
        }
    `;
    document.head.appendChild(style);
}

// Rafraîchissement manuel
async function manualRefresh() {
    if (!DOM.refreshBtn) return;

    const now = Date.now();
    if (now - state.lastRefreshTime < CONFIG.minRefreshDelay) {
        showNotification('Merci de patienter avant de rafraîchir à nouveau', 'warning');
        return;
    }

    state.lastRefreshTime = now;
    DOM.refreshBtn.classList.add('rotating');
    DOM.refreshBtn.disabled = true;

    try {
        await refreshDashboard(true);
    } catch {
        setTimeout(() => window.location.reload(), 500);
    } finally {
        DOM.refreshBtn.classList.remove('rotating');
        DOM.refreshBtn.disabled = false;
    }
}

// Génération de code
async function generateNewCode() {
    if (!DOM.generateBtn) return;

    try {
        DOM.generateBtn.disabled = true;
        DOM.generateBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Génération...';

        await new Promise(resolve => setTimeout(resolve, 300));

        const response = await fetch('/api/code', {
            method: 'POST',
            headers: getRequestHeaders(),
            credentials: 'same-origin'
        });

        if (response.ok) {
            const data = await response.json();
            if (!data.code) throw new Error('Réponse invalide du serveur');

            const validTime = new Date(data.valid_until).toLocaleTimeString();
            showNotification(`Nouveau code généré: ${sanitizeHTML(data.code)}\nValide jusqu'à ${sanitizeHTML(validTime)}`);

            setTimeout(async () => {
                await refreshDashboard(true);
                resetGenerateButton();
            }, 1000);
        } else {
            throw await handleApiError(response);
        }
    } catch (error) {
        console.error('Erreur:', error);
        showNotification(error.message || 'Erreur de connexion au serveur', 'error');
        resetGenerateButton(true);
    }
}

// Rafraîchissement du dashboard
async function refreshDashboard(forceRefresh = false) {
    if (!state.autoRefreshEnabled || (state.isRefreshing && !forceRefresh)) return false;

    state.isRefreshing = true;
    if (DOM.dashboardContainer) DOM.dashboardContainer.classList.add('refreshing');

    try {
        const [codeData, logsData, alertsData] = await Promise.all([
            fetchData('/api/code'),
            fetchData('/api/logs'),
            fetchData('/api/alerts')
        ]);

        updateCodeDisplay(codeData);
        if (logsData) updateLogs(logsData.logs);
        if (alertsData) updateAlerts(alertsData.alerts);

        updateLastRefreshTime();
        state.apiFailCount = 0;
        if (state.connectionProblem) {
            showNotification('Connexion au serveur rétablie', 'success');
            state.connectionProblem = false;
        }

        return true;
    } catch (error) {
        console.error('Refresh failed:', error);
        state.apiFailCount++;
        handleApiFailure();
        return false;
    } finally {
        state.isRefreshing = false;
        if (DOM.dashboardContainer) {
            setTimeout(() => DOM.dashboardContainer.classList.remove('refreshing'), 300);
        }
    }
}

// Mise à jour de l'affichage
function updateCodeDisplay(data) {
    if (!DOM.codeElement || !DOM.statusElement) return;

    const code = data?.current_code;
    if (!code?.value) return;

    const isValid = isCodeValid(code);

    DOM.codeElement.textContent = code.value;
    DOM.codeElement.classList.toggle('expired-code', !isValid);

    DOM.statusElement.classList.remove('active', 'used');
    DOM.statusElement.classList.toggle('expired', !isValid);
    DOM.statusElement.textContent = isValid ? 'ACTIF' : 'EXPIRÉ';

    updateRemainingTime();
}

function updateLogs(logs) {
    if (!DOM.logEntries || !logs || !Array.isArray(logs)) return;
    if (document.querySelector('.pagination')) return;

    if (logs.length === 0) {
        DOM.logEntries.innerHTML = `
            <div class="empty-state">
                <i class="bi bi-journal"></i>
                <p>Aucun événement enregistré</p>
            </div>
        `;
        return;
    }

    DOM.logEntries.innerHTML = logs.slice(0, 10).map(log => `
        <div class="log-entry ${log.status || ''}">
            <div class="log-icon">${getLogIcon(log)}</div>
            <div class="log-details">
                <div class="log-main">
                    <span class="log-event">${getLogEventText(log)}</span>
                    <span class="log-time">${formatTimestamp(log.timestamp)}</span>
                </div>
                <div class="log-secondary">
                    <span class="log-agent"><i class="bi bi-person"></i> ${log.agent || 'Inconnu'}</span>
                    ${log.code_used ? `<span class="log-code"><i class="bi bi-123"></i> ${log.code_used}</span>` : ''}
                </div>
                ${log.reason ? `
                    <div class="log-reason">
                        <i class="bi bi-info-circle"></i> ${formatReason(log.reason)}
                    </div>
                ` : ''}
            </div>
        </div>
    `).join('');
}

function updateAlerts(alerts) {
    if (!DOM.alertEntries || !alerts) return;
    if (document.querySelector('.pagination')) return;

    if (DOM.alertCounter) {
        DOM.alertCounter.textContent = `${alerts.length} non résolue${alerts.length !== 1 ? 's' : ''}`;
    }

    if (alerts.length === 0) {
        DOM.alertEntries.innerHTML = `
            <div class="empty-state">
                <i class="bi bi-check-circle"></i>
                <p>Aucune alerte active</p>
            </div>
        `;
        return;
    }

    DOM.alertEntries.innerHTML = alerts.map((alert, index) => `
        <div class="alert-entry severity-${alert.severity}" data-alert-index="${alert._index || index}">
            <div class="alert-icon">
                <i class="bi bi-exclamation-triangle-fill"></i>
            </div>
            <div class="alert-content">
                <div class="alert-header">
                    <span class="alert-title">${formatAlertType(alert.type)}</span>
                    <span class="alert-severity">${alert.severity.charAt(0).toUpperCase() + alert.severity.slice(1)}</span>
                </div>
                <p class="alert-message">${alert.message}</p>
                <div class="alert-footer">
                    <span class="alert-time">${formatTimestamp(alert.timestamp)}</span>
                    <button class="btn btn-resolve resolve-btn" data-alert-index="${alert._index || index}">
                        <i class="bi bi-check-lg"></i>
                    </button>
                </div>
            </div>
        </div>
    `).join('');
}

// Gestion des alertes
async function handleResolveAlert(button) {
    const alertIndex = button.dataset.alertIndex;
    const alertItem = button.closest('.alert-entry');
    if (!alertItem) return;

    button.disabled = true;
    const originalHtml = button.innerHTML;
    button.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';

    try {
        const response = await fetch(`/api/alert/${alertIndex}/resolve`, {
            method: 'POST',
            headers: getRequestHeaders(),
            credentials: 'same-origin'
        });

        if (!response.ok) throw await handleApiError(response);

        animateAlertRemoval(alertItem);
        updateAlertCounter();
        checkEmptyAlerts();
    } catch (error) {
        console.error('Erreur:', error);
        showNotification(error.message || 'Erreur lors de la résolution', 'error');
        button.innerHTML = originalHtml;
        button.disabled = false;
    }
}

function animateAlertRemoval(alertItem) {
    alertItem.style.transition = 'all 0.3s ease';
    alertItem.style.opacity = '0';
    alertItem.style.height = `${alertItem.offsetHeight}px`;

    setTimeout(() => {
        alertItem.style.height = '0';
        alertItem.style.margin = '0';
        alertItem.style.padding = '0';
        alertItem.style.border = 'none';

        setTimeout(() => alertItem.remove(), 300);
    }, 200);
}

function updateAlertCounter() {
    if (!DOM.alertCounter) return;
    const remainingAlerts = document.querySelectorAll('.alert-entry').length;
    DOM.alertCounter.textContent = `${remainingAlerts} non résolue${remainingAlerts !== 1 ? 's' : ''}`;
}

function checkEmptyAlerts() {
    if (!DOM.alertEntries) return;
    if (DOM.alertEntries.querySelectorAll('.alert-entry').length === 0) {
        DOM.alertEntries.innerHTML = `
            <div class="empty-state">
                <i class="bi bi-check-circle"></i>
                <p>Aucune alerte active</p>
            </div>
        `;
    }
}

// Utilitaires
function getRequestHeaders() {
    return {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
    };
}

async function fetchData(endpoint) {
    const response = await fetch(endpoint, {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        credentials: 'same-origin'
    });
    if (!response.ok) throw new Error(`Erreur HTTP: ${response.status}`);
    return await response.json();
}

async function handleApiError(response) {
    try {
        const error = await response.json();
        return new Error(error.error || 'Échec de la requête API');
    } catch {
        return new Error('Erreur lors de la lecture de la réponse');
    }
}

function isCodeValid(code) {
    if (!code?.valid_until) return false;
    try {
        return new Date(code.valid_until) > new Date();
    } catch (e) {
        console.error('Erreur lors de la vérification du code:', e);
        return false;
    }
}

function updateRemainingTime() {
    if (!DOM.timeLeftDisplay || !DOM.codeElement || !DOM.validUntilElement) return;

    try {
        const timeText = DOM.validUntilElement.textContent.replace('Valide jusqu\'à ', '').trim();
        const now = new Date();
        let validUntil;

        if (timeText.includes('/')) {
            const [datePart, timePart] = timeText.split(' ');
            const [day, month, year] = datePart.split('/').map(Number);
            const [hours, minutes, seconds] = timePart.split(':').map(Number);
            validUntil = new Date(year, month - 1, day, hours, minutes, seconds);
        } else if (timeText.includes('-')) {
            validUntil = new Date(timeText);
        } else {
            const [hours, minutes, seconds] = timeText.split(':').map(Number);
            validUntil = new Date();
            validUntil.setHours(hours, minutes, seconds);
        }

        if (isNaN(validUntil.getTime())) throw new Error('Format de date invalide');

        if (validUntil < now) {
            setCodeExpired();
            return;
        }

        const diffInSeconds = Math.floor((validUntil - now) / 1000);
        updateTimeDisplay(diffInSeconds);
    } catch (error) {
        console.error('Erreur dans updateRemainingTime:', error);
        DOM.timeLeftDisplay.textContent = 'Format invalide';
        DOM.timeLeftDisplay.className = 'badge time-badge bg-secondary';
    }
}

function setCodeExpired() {
    DOM.timeLeftDisplay.textContent = 'Expiré';
    DOM.timeLeftDisplay.className = 'badge time-badge bg-danger';
    DOM.codeElement.classList.add('expired-code');

    if (DOM.statusElement) {
        DOM.statusElement.textContent = 'EXPIRÉ';
        DOM.statusElement.classList.remove('active', 'used');
        DOM.statusElement.classList.add('expired');
    }
}

function updateTimeDisplay(seconds) {
    if (seconds <= 0) {
        DOM.timeLeftDisplay.textContent = 'Expiré';
        DOM.timeLeftDisplay.className = 'badge time-badge bg-danger';
    } else {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        DOM.timeLeftDisplay.textContent = `${mins}:${secs.toString().padStart(2, '0')} restants`;
        DOM.timeLeftDisplay.className = seconds < 60
            ? 'badge time-badge bg-warning text-dark' 
            : 'badge time-badge bg-light text-dark';
    }
}

function updateLastRefreshTime() {
    if (DOM.updateTimeElement) {
        DOM.updateTimeElement.textContent = new Date().toLocaleTimeString();
    }
}

function startAutoRefresh() {
    setInterval(updateRemainingTime, 1000);
    setInterval(() => state.autoRefreshEnabled && refreshDashboard(), CONFIG.refreshInterval);
    setInterval(updateLastRefreshTime, 60000);
    setInterval(checkApiStatus, 30000);
    checkApiStatus();
}

async function checkApiStatus() {
    try {
        const response = await fetch('/api/code', {
            headers: { 'X-Requested-With': 'XMLHttpRequest' },
            credentials: 'same-origin'
        });

        if (response.ok) {
            state.apiFailCount = 0;
            if (state.connectionProblem) {
                showNotification('Connexion au serveur rétablie', 'success');
                state.connectionProblem = false;
            }
        } else {
            throw new Error('API non disponible');
        }
    } catch {
        state.apiFailCount++;
        handleApiFailure();
    }
}

function handleApiFailure() {
    if (state.apiFailCount >= CONFIG.maxRetries && !state.connectionProblem) {
        showNotification('Problème de connexion avec le serveur. Essayez de rafraîchir la page.', 'error');
        state.connectionProblem = true;
    }
}

function handleFooterLayout() {
    const footer = document.querySelector('.dashboard-footer');
    if (footer) {
        footer.style.padding = window.innerWidth < 768 ? '0.8rem 0' : '1rem 0';
    }
}

window.addEventListener('resize', handleFooterLayout);

// Fonctions utilitaires restantes
function getLogIcon(log) {
    if (log.event === "door_open") {
        return log.status === "success"
            ? '<i class="bi bi-door-open success"></i>' 
            : '<i class="bi bi-door-closed danger"></i>';
    } else if (log.event === "door_close") {
        return '<i class="bi bi-door-closed primary"></i>';
    }
    return '<i class="bi bi-activity warning"></i>';
}

function getLogEventText(log) {
    if (log.event === "door_open") return log.status === "success" ? 'Ouverture' : 'Tentative échouée';
    if (log.event === "door_close") return 'Fermeture';
    return log.event;
}

function formatTimestamp(timestamp) {
    if (!timestamp) return '';
    try {
        return new Date(timestamp).toLocaleString();
    } catch {
        return timestamp;
    }
}

function formatReason(reason) {
    return reason ? reason.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : '';
}

function formatAlertType(type) {
    return type ? type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : '';
}

function sanitizeHTML(str) {
    if (!str) return '';
    const temp = document.createElement('div');
    temp.textContent = str;
    return temp.innerHTML;
}

function showNotification(message, type = 'success') {
    message = sanitizeHTML(message);
    const notification = document.createElement('div');
    notification.className = `toast align-items-center text-white bg-${
        type === 'success' ? 'success' : type === 'warning' ? 'warning' : 'danger'
    } position-fixed bottom-0 end-0 m-3`;
    notification.setAttribute('role', 'alert');
    notification.innerHTML = `
        <div class="d-flex">
            <div class="toast-body">${message.replace(/\n/g, '<br>')}</div>
            <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
        </div>
    `;
    document.body.appendChild(notification);
    setTimeout(() => {
        notification.classList.add('show');
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 500);
        }, 3000);
    }, 100);
}

function resetGenerateButton(isError = false) {
    if (!DOM.generateBtn) return;
    DOM.generateBtn.disabled = false;
    DOM.generateBtn.innerHTML = isError
        ? '<i class="bi bi-key-fill me-2"></i>Réessayer' 
        : '<i class="bi bi-plus-circle"></i> Générer un code';
}

document.addEventListener('DOMContentLoaded', function () {
    // Intercepter les clics sur les liens de pagination
    setupPagination('.history-card', 'logs_page', loadLogs);
    setupPagination('.alerts-card', 'alerts_page', loadAlerts);

    function setupPagination(cardSelector, pageParam, loadFunction) {
        const card = document.querySelector(cardSelector);
        if (!card) return;

        // Attacher les écouteurs d'événements aux liens de pagination
        card.addEventListener('click', function (e) {
            // Vérifier si c'est un lien de pagination qui a été cliqué
            const target = e.target.closest('.page-link');
            if (!target) return;

            e.preventDefault(); // Empêcher le comportement par défaut

            // Extraire le numéro de page de l'URL
            const href = target.getAttribute('href');
            const url = new URL(href, window.location.origin);
            const page = url.searchParams.get(pageParam);

            if (page) {
                // Charger les nouvelles données
                loadFunction(page);

                // Mettre à jour l'URL sans recharger la page
                const newUrl = new URL(window.location);
                newUrl.searchParams.set(pageParam, page);
                window.history.pushState({}, '', newUrl);

                // Ajouter une classe pour l'effet de transition
                card.querySelector('.card-body').classList.add('refreshing');
                setTimeout(() => {
                    card.querySelector('.card-body').classList.remove('refreshing');
                }, 300);
            }
        });
    }

    function loadLogs(page) {
        fetch(`/api/logs?page=${page}&per_page=5`)
            .then(response => response.json())
            .then(data => {
                updateLogsUI(data);
            })
            .catch(error => console.error('Erreur lors du chargement des logs:', error));
    }

    function loadAlerts(page) {
        fetch(`/api/alerts?page=${page}&per_page=5&show_resolved=false`)
            .then(response => response.json())
            .then(data => {
                updateAlertsUI(data);
            })
            .catch(error => console.error('Erreur lors du chargement des alertes:', error));
    }

    function updateLogsUI(data) {
        const logsContainer = document.querySelector('.history-card .log-entries');
        const paginationContainer = document.querySelector('.history-card .pagination');

        if (!logsContainer) return;

        // Effacer le contenu existant
        logsContainer.innerHTML = '';

        // Si aucun log, afficher l'état vide
        if (!data.logs || data.logs.length === 0) {
            logsContainer.innerHTML = `
                <div class="empty-state">
                    <i class="bi bi-journal"></i>
                    <p>Aucun événement enregistré</p>
                </div>
            `;
            return;
        }

        // Générer le HTML pour chaque log
        data.logs.forEach(log => {
            let iconClass = 'bi-activity warning';
            if (log.event === 'door_open') {
                iconClass = log.status === 'success' ? 'bi-door-open success' : 'bi-door-closed danger';
            } else if (log.event === 'door_close') {
                iconClass = 'bi-door-closed primary';
            }

            const logHtml = `
                <div class="log-entry ${log.status || ''}">
                    <div class="log-icon">
                        <i class="bi ${iconClass}"></i>
                    </div>
                    <div class="log-details">
                        <div class="log-main">
                            <span class="log-event">
                                ${log.event === 'door_open'
                ? (log.status === 'success' ? 'Ouverture' : 'Tentative échouée')
                : log.event === 'door_close' ? 'Fermeture' : log.event}
                            </span>
                            <span class="log-time">${formatDateTime(log.timestamp)}</span>
                        </div>
                        <div class="log-secondary">
                            <span class="log-agent"><i class="bi bi-person"></i> ${log.agent || 'Inconnu'}</span>
                            ${log.code_used ? `<span class="log-code"><i class="bi bi-key"></i> ${log.code_used}</span>` : ''}
                        </div>
                        ${log.reason ? `
                            <div class="log-reason">
                                <i class="bi bi-info-circle"></i> ${log.reason.replace(/_/g, ' ').charAt(0).toUpperCase() + log.reason.replace(/_/g, ' ').slice(1)}
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;
            logsContainer.innerHTML += logHtml;
        });

        // Mettre à jour la pagination
        if (paginationContainer && data.pagination) {
            updatePagination(paginationContainer, data.pagination, 'logs_page');
        }
    }

    function updateAlertsUI(data) {
        const alertsContainer = document.querySelector('.alerts-card .alert-entries');
        const paginationContainer = document.querySelector('.alerts-card .pagination');

        if (!alertsContainer) return;

        // Effacer le contenu existant
        alertsContainer.innerHTML = '';

        // Si aucune alerte, afficher l'état vide
        if (!data.alerts || data.alerts.length === 0) {
            alertsContainer.innerHTML = `
                <div class="empty-state">
                    <i class="bi bi-check-circle"></i>
                    <p>Aucune alerte active</p>
                </div>
            `;
            return;
        }

        // Générer le HTML pour chaque alerte
        data.alerts.forEach((alert, index) => {
            const alertHtml = `
                <div class="alert-entry severity-${alert.severity}" data-alert-index="${alert._index !== undefined ? alert._index : index}">
                    <div class="alert-icon">
                        <i class="bi bi-exclamation-triangle-fill"></i>
                    </div>
                    <div class="alert-content">
                        <div class="alert-header">
                            <span class="alert-title">${alert.type.replace(/_/g, ' ').charAt(0).toUpperCase() + alert.type.replace(/_/g, ' ').slice(1)}</span>
                            <span class="alert-severity">${alert.severity.charAt(0).toUpperCase() + alert.severity.slice(1)}</span>
                        </div>
                        <p class="alert-message">${alert.message}</p>
                        <div class="alert-footer">
                            <span class="alert-time">${formatDateTime(alert.timestamp)}</span>
                            <button class="btn btn-resolve resolve-btn" data-alert-index="${alert._index !== undefined ? alert._index : index}">
                                <i class="bi bi-check-lg"></i>
                            </button>
                        </div>
                    </div>
                </div>
            `;
            alertsContainer.innerHTML += alertHtml;
        });

        // Réattacher les événements pour les boutons de résolution
        document.querySelectorAll('.resolve-btn').forEach(btn => {
            btn.addEventListener('click', handleAlertResolve);
        });

        // Mettre à jour la pagination
        if (paginationContainer && data.pagination) {
            updatePagination(paginationContainer, data.pagination, 'alerts_page');
        }
    }

    function updatePagination(container, pagination, pageParam) {
        const currentPage = pagination.page;
        const totalPages = pagination.pages;

        if (totalPages <= 1) {
            container.style.display = 'none';
            return;
        }

        container.style.display = 'flex';

        // Créer la structure de pagination
        let paginationHtml = `
            <ul class="pagination">
                <li class="page-item ${currentPage <= 1 ? 'disabled' : ''}">
                    <a class="page-link" href="?${pageParam}=${currentPage - 1}" aria-label="Précédent">
                        <i class="bi bi-chevron-left"></i>
                    </a>
                </li>
        `;

        // Ajouter les numéros de page
        const startPage = Math.max(1, currentPage - 2);
        const endPage = Math.min(totalPages, currentPage + 2);

        for (let i = startPage; i <= endPage; i++) {
            paginationHtml += `
                <li class="page-item ${i === currentPage ? 'active' : ''}">
                    <a class="page-link" href="?${pageParam}=${i}">${i}</a>
                </li>
            `;
        }

        paginationHtml += `
                <li class="page-item ${currentPage >= totalPages ? 'disabled' : ''}">
                    <a class="page-link" href="?${pageParam}=${currentPage + 1}" aria-label="Suivant">
                        <i class="bi bi-chevron-right"></i>
                    </a>
                </li>
            </ul>
        `;

        container.innerHTML = paginationHtml;
    }

    function handleAlertResolve(e) {
        const alertIndex = e.currentTarget.dataset.alertIndex;

        fetch(`/api/alert/${alertIndex}/resolve`, {
            method: 'POST'
        })
            .then(response => response.json())
            .then(data => {
                if (data.status === 'alert_resolved') {
                    // Recharger les alertes
                    const currentPage = new URL(window.location).searchParams.get('alerts_page') || '1';
                    loadAlerts(currentPage);
                }
            })
            .catch(error => console.error('Erreur lors de la résolution de l\'alerte:', error));
    }

    function formatDateTime(timestamp) {
        if (!timestamp) return '';

        const date = new Date(timestamp);
        return date.toLocaleString('fr-FR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    }
});

