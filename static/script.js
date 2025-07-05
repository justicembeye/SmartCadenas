/**
 * script.js - Fonctions JavaScript pour SmartCadenas
 * Gère le rafraîchissement des données, les interactions utilisateur et les animations
 */

const CONFIG = {
    refreshInterval: 10000,    // Intervalle de rafraîchissement en ms
    apiTimeout: 7000,          // Timeout pour les requêtes API en ms (un peu augmenté)
    maxRetries: 3,             // Nombre maximal de tentatives en cas d'échec API
    minRefreshDelay: 2000      // Délai minimum entre les rafraîchissements manuels
};

const state = {
    refreshTimer: null,
    isRefreshing: false,
    currentCode: null, // Structure attendue: { value, valid_until, generated_at, used, used_for_entry } ou null
    connectionProblem: false,
    lastRefreshTime: Date.now(),
    autoRefreshEnabled: true,
    apiFailCount: 0
};

const DOM = {
    get refreshBtn() { return document.getElementById('refresh-btn'); },
    get generateBtn() { return document.getElementById('generate-btn'); },
    get dashboardContainer() { return document.querySelector('.dashboard-container'); },
    get codeElement() { return document.querySelector('.code-display'); },
    get statusElement() { return document.querySelector('.meta-item.status'); },
    get timeLeftDisplay() { return document.getElementById('time-left'); },
    get validUntilElement() { return document.querySelector('.meta-item.validity span:last-child'); }, // Corrigé pour cibler le span précis
    get updateTimeElement() { return document.getElementById('update-time'); },
    get logEntriesContainer() { return document.querySelector('.history-card .log-entries'); },
    get alertEntriesContainer() { return document.querySelector('.alerts-card .alert-entries'); },
    get logPaginationContainer() { return document.querySelector('.history-card .pagination-container'); },
    get alertPaginationContainer() { return document.querySelector('.alerts-card .pagination-container'); },
    get alertCounter() { return document.querySelector('.alerts-card .badge.counter-badge.alert'); }
};

document.addEventListener('DOMContentLoaded', () => {
    setupEventHandlers();
    handleFooterLayout();

    // Charge les données initiales et seulement ensuite démarre les timers
    refreshDashboard(true).finally(() => {
        updateRemainingTime(); // Initialise l'affichage du compte à rebours
        startAutoRefresh();    // Démarre les rafraîchissements automatiques
    });

    // Initialisation de la pagination (les données sont chargées par refreshDashboard)
    const currentUrlParams = new URLSearchParams(window.location.search);
    const initialLogsPage = currentUrlParams.get('logs_page') || '1';
    const initialAlertsPage = currentUrlParams.get('alerts_page') || '1';

    // Les fonctions loadLogs et loadAlerts seront appelées par refreshDashboard,
    // ou par les clics sur la pagination.
    // Pour que la pagination initiale respecte les params URL, refreshDashboard les lit.

    setupPagination('.history-card', 'logs_page', loadLogs);
    setupPagination('.alerts-card', 'alerts_page', loadAlerts);
    console.log("Dashboard di SmartLock inizializzato.");
});

function setupEventHandlers() {
    if (DOM.refreshBtn) DOM.refreshBtn.addEventListener('click', manualRefresh);
    if (DOM.generateBtn) DOM.generateBtn.addEventListener('click', generateNewCode);

    // Gestionnaire délégué pour les boutons de résolution d'alerte
    document.addEventListener('click', e => {
        const resolveButton = e.target.closest('.resolve-btn');
        if (resolveButton) {
            e.preventDefault(); // Important pour les boutons dans des liens
            handleAlertResolve(resolveButton);
        }
    });
}

async function manualRefresh() {
    if (!DOM.refreshBtn || DOM.refreshBtn.disabled) return;
    const now = Date.now();
    if (now - state.lastRefreshTime < CONFIG.minRefreshDelay && !state.isRefreshing) {
        showNotification('Si prega di attendere prima di aggiornare nuovamente.', 'warning');
        return;
    }
    state.lastRefreshTime = now;
    DOM.refreshBtn.classList.add('rotating');
    DOM.refreshBtn.disabled = true;
    try {
        await refreshDashboard(true); // Forcer le rafraîchissement
    } catch (error) {
        showNotification("Errore nell'aggiornamento manuale.", "error");
    } finally {
        if (DOM.refreshBtn) { // S'assurer que l'élément existe encore
            DOM.refreshBtn.classList.remove('rotating');
            DOM.refreshBtn.disabled = false;
        }
    }
}

async function generateNewCode() {
    if (!DOM.generateBtn || DOM.generateBtn.disabled) return;

    DOM.generateBtn.disabled = true;
    DOM.generateBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Génération...';

    try {
        const response = await fetch('/api/code', { // POST pour générer
            method: 'POST',
            headers: getRequestHeaders(),
            credentials: 'same-origin',
            signal: AbortSignal.timeout(CONFIG.apiTimeout)
        });

        if (response.ok) {
            const apiData = await response.json(); // API renvoie { code, valid_until, generated_at }
            if (!apiData.code || !apiData.valid_until) {
                throw new Error('Risposta API non valida per la generazione del codice.');
            }

            state.currentCode = {
                value: apiData.code,
                valid_until: apiData.valid_until,
                generated_at: apiData.generated_at,
                used: false, // Un nouveau code est toujours non utilisé
                used_for_entry: false
            };

            const validTime = new Date(state.currentCode.valid_until).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            showNotification(`Nuovo codice generato: ${sanitizeHTML(state.currentCode.value)}. Valido fino a ${sanitizeHTML(validTime)}`, 'success');

            updateCodeDisplay(); // Mettre à jour l'UI immédiatement avec le nouveau state.currentCode
                                 // updateRemainingTime() sera appelé à l'intérieur de updateCodeDisplay

        } else {
            throw await handleApiError(response);
        }
    } catch (error) {
        console.error('Errore generazione codice:', error);
        showNotification(error.message || 'Errore di connessione al server durante la generazione.', 'error');
    } finally {
        resetGenerateButton();
    }
}

async function refreshDashboard(forceRefresh = false) {
    if (!state.autoRefreshEnabled && !forceRefresh) return Promise.resolve(false);
    if (state.isRefreshing && !forceRefresh) return Promise.resolve(false);

    state.isRefreshing = true;
    if (DOM.dashboardContainer) DOM.dashboardContainer.classList.add('refreshing');

    try {
        const currentUrlParams = new URLSearchParams(window.location.search);
        const logsPage = currentUrlParams.get('logs_page') || '1';
        const alertsPage = currentUrlParams.get('alerts_page') || '1';

        const codeApiResponse = await fetchData('/api/code'); // GET pour l'état actuel du code

        if (codeApiResponse && codeApiResponse.code && codeApiResponse.valid_until) {
            // L'API GET /api/code renvoie une structure plate: { code, valid_until, used, generated_at, ... }
            state.currentCode = {
                value: codeApiResponse.code,
                valid_until: codeApiResponse.valid_until,
                generated_at: codeApiResponse.generated_at,
                used: codeApiResponse.used || false, // Assurer une valeur booléenne
                used_for_entry: codeApiResponse.used_for_entry || false, // Assurer une valeur booléenne
            };
        } else {
            state.currentCode = null; // Pas de code actif ou réponse invalide
        }
        updateCodeDisplay(); // Mettre à jour l'UI du code basé sur state.currentCode

        // Charger les logs et les alertes en parallèle
        const [logsData, alertsData] = await Promise.all([
            fetchData(`/api/logs?page=${logsPage}&per_page=5`),
            fetchData(`/api/alerts?page=${alertsPage}&per_page=5&show_resolved=false`)
        ]);

        if (logsData) updateLogsUI(logsData, logsPage, alertsPage);
        if (alertsData) updateAlertsUI(alertsData, alertsPage, logsPage);

        updateLastRefreshTime();
        state.apiFailCount = 0;
        if (state.connectionProblem) {
            showNotification('Connessione al server ripristinata.', 'success');
            state.connectionProblem = false;
        }
        return true;
    } catch (error) {
        console.error('Aggiornamento della dashboard fallito:', error);
        state.apiFailCount++;
        handleApiFailure(); // Gère la notification d'erreur si nécessaire
        state.currentCode = null; // En cas d'erreur majeure, considérer qu'il n'y a pas de code
        updateCodeDisplay(); // Afficher l'état "aucun code"
        return false;
    } finally {
        state.isRefreshing = false;
        if (DOM.dashboardContainer) {
            setTimeout(() => DOM.dashboardContainer.classList.remove('refreshing'), 300);
        }
    }
}

function updateCodeDisplay() {
    if (!DOM.codeElement || !DOM.statusElement || !DOM.timeLeftDisplay || !DOM.validUntilElement) {
        return;
    }

    const codeToDisplay = state.currentCode;

    if (!codeToDisplay || !codeToDisplay.value) {
        DOM.codeElement.textContent = "----";
        DOM.codeElement.className = 'code-display expired-code'; // Style "pas de code"
        DOM.statusElement.textContent = 'NESSUN CODICE';
        DOM.statusElement.className = 'meta-item status expired'; // Style pour "aucun code"
        DOM.timeLeftDisplay.textContent = 'Inattivo';
        DOM.timeLeftDisplay.className = 'badge time-badge bg-secondary';
        DOM.validUntilElement.textContent = 'N/D';
        return;
    }

    const isActuallyUsed = codeToDisplay.used;
    const isStillValidDate = isCodeValid(codeToDisplay); // Vérifie si valid_until > now

    DOM.codeElement.textContent = codeToDisplay.value;

    if (isActuallyUsed) {
        DOM.codeElement.className = 'code-display expired-code'; // Style "utilisé" (peut être comme expiré)
        DOM.statusElement.textContent = 'UTILIZZATO';
        DOM.statusElement.className = 'meta-item status used'; // Classe CSS 'used'
        DOM.timeLeftDisplay.textContent = 'Utilizzato';
        DOM.timeLeftDisplay.className = 'badge time-badge bg-info text-dark'; // Style pour "utilisé"
    } else if (!isStillValidDate) {
        DOM.codeElement.className = 'code-display expired-code';
        DOM.statusElement.textContent = 'SCADUTO';
        DOM.statusElement.className = 'meta-item status expired';
        DOM.timeLeftDisplay.textContent = 'Scaduto';
        DOM.timeLeftDisplay.className = 'badge time-badge bg-danger';
    } else { // Code VALIDE et NON UTILISÉ
        DOM.codeElement.className = 'code-display'; // Style normal
        DOM.statusElement.textContent = 'ATTIVO';
        DOM.statusElement.className = 'meta-item status active'; // Style vert pour actif
        // Le compte à rebours est géré par updateRemainingTime
    }

    if (codeToDisplay.valid_until) {
        try {
            DOM.validUntilElement.textContent = `Valido fino a ${new Date(codeToDisplay.valid_until).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
        } catch (e) { DOM.validUntilElement.textContent = 'Erreur date'; }
    } else {
        DOM.validUntilElement.textContent = 'N/D';
    }
    // updateRemainingTime est appelé par l'intervalle, mais un appel ici assure la synchro immédiate
    updateRemainingTime();
}

function updateRemainingTime() {
    if (!DOM.timeLeftDisplay) return;
    const code = state.currentCode;

    if (!code || !code.value || !code.valid_until) {
        if (DOM.timeLeftDisplay.textContent !== 'Inattivo') {
             DOM.timeLeftDisplay.textContent = 'Inattivo';
             DOM.timeLeftDisplay.className = 'badge time-badge bg-secondary';
        }
        return;
    }

    if (code.used) {
        if (DOM.timeLeftDisplay.textContent !== 'Utilizzato') {
            DOM.timeLeftDisplay.textContent = 'Utilizzato';
            DOM.timeLeftDisplay.className = 'badge time-badge bg-info text-dark';
        }
        return;
    }

    try {
        const validUntilDate = new Date(code.valid_until);
        const now = new Date();

        if (isNaN(validUntilDate.getTime())) {
            setCodeExpiredStyles();
            return;
        }

        if (validUntilDate < now) {
            setCodeExpiredStyles();
            return;
        }
        const diffInSeconds = Math.floor((validUntilDate - now) / 1000);
        updateTimeDisplay(diffInSeconds); // Met à jour le texte et la couleur du badge
    } catch (error) {
        console.error('Erreur dans updateRemainingTime:', error);
        DOM.timeLeftDisplay.textContent = 'Errore';
        DOM.timeLeftDisplay.className = 'badge time-badge bg-danger';
    }
}

function setCodeExpiredStyles() {
    if (DOM.timeLeftDisplay) {
        DOM.timeLeftDisplay.textContent = 'Scaduto';
        DOM.timeLeftDisplay.className = 'badge time-badge bg-danger';
    }
    if (DOM.codeElement) DOM.codeElement.classList.add('expired-code');
    if (DOM.statusElement) {
        DOM.statusElement.textContent = 'SCADUTO';
        DOM.statusElement.className = 'meta-item status expired';
    }
}

function updateTimeDisplay(seconds) {
    if (!DOM.timeLeftDisplay) return;
    // Ne pas écraser si le statut est déjà final (géré par updateRemainingTime/updateCodeDisplay)
    if (DOM.timeLeftDisplay.textContent === 'Scaduto' || DOM.timeLeftDisplay.textContent === 'Utilizzato' || DOM.timeLeftDisplay.textContent === 'Inattivo') {
        return;
    }

    if (seconds <= 0) {
        // Ce cas devrait être traité par updateRemainingTime qui appelle setCodeExpiredStyles.
        // Si on arrive ici, c'est une sécurité.
        DOM.timeLeftDisplay.textContent = 'Scaduto';
        DOM.timeLeftDisplay.className = 'badge time-badge bg-danger';
    } else {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        DOM.timeLeftDisplay.textContent = `${mins}:${secs.toString().padStart(2, '0')} rimanenti`;
        if (seconds < 60) {
            DOM.timeLeftDisplay.className = 'badge time-badge bg-warning text-dark';
        } else {
            DOM.timeLeftDisplay.className = 'badge time-badge bg-light text-dark';
        }
    }
}

function startAutoRefresh() {
    setInterval(updateRemainingTime, 1000);
    if (state.autoRefreshEnabled) {
        state.refreshTimer = setInterval(() => {
            if (state.autoRefreshEnabled && !document.hidden) {
                 refreshDashboard();
            }
        }, CONFIG.refreshInterval);
    }
    setInterval(updateLastRefreshTime, 60000);
}

function getEnhancedEventDescription(log) {
    if (log.event === 'door_open') {
        return log.status === 'success' ? "Ingresso agente autorizzato (sito)" : `Tentativo di ingresso fallito (${log.reason || 'motivo sconosciuto'})`;
    } else if (log.event === 'door_close') {
        if (log.code_used === '_LBE_') { //
            return "Uscita agente autorizzata (tramite pulsante)";
        } else if (log.code_used === '' && log.reason && log.reason.toLowerCase().includes('senza codice d\'ingresso valido precedente')) {
            return "Uscita tramite pulsante (Sospetta/Non autorizzata)";
        } else if (log.status === 'success' && log.reason && log.reason.toLowerCase().includes("cycle d_accès complet")) {
            return "Chiusura porta (Fine del ciclo di accesso)";
        } else if (log.code_used && log.code_used.length > 0 && log.status === 'success') {
            return `Fermeture Porte (Code ${log.code_used} invalidé)`;
        }
        return "Chiusura porta (Generale)";
    }
    return log.event ? log.event.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'Evento sconosciuto';
}

function getEnhancedLogIconClass(log, enhancedDescription) {
    if (enhancedDescription.includes("Ingresso agente autorizzato")) return 'bi bi-door-open success'; // Votre icône préférée
    if (enhancedDescription.includes("Tentativo di ingresso")) return 'bi bi-shield-lock danger';
    if (enhancedDescription.includes("Uscita agente autorizzata")) return 'bi bi-door-open primary'; // Votre icône préférée, couleur neutre
    if (enhancedDescription.includes("Uscita tramite pulsante (Sospetta/Non autorizzata)")) return 'bi bi-exclamation-diamond-fill warning';
    if (enhancedDescription.includes("Chiusura porta (Fine del ciclo di accesso)")) return 'bi bi-door-closed text-muted'; // Votre icône préférée, discrète
    if (enhancedDescription.includes("Chiusura porta (Codice")) return 'bi bi-door-closed text-muted';
    if (log.event === "door_close") return 'bi bi-door-closed primary';
    return 'bi bi-activity warning';
}

function updateLogsUI(data, currentPageLogs, currentPageAlerts) {
    const logsContainer = DOM.logEntriesContainer;
    const paginationContainer = DOM.logPaginationContainer;

    if (!logsContainer) { return; }
    logsContainer.innerHTML = '';

    if (!data.logs || data.logs.length === 0) {
        logsContainer.innerHTML = `<div class="empty-state"><i class="bi bi-journal-x"></i><p>Nessun evento di accesso registrato</p></div>`;
        if (paginationContainer) paginationContainer.innerHTML = '';
        return;
    }

    data.logs.forEach(log => {
        const enhancedDescription = getEnhancedEventDescription(log);
        const logIconClass = getEnhancedLogIconClass(log, enhancedDescription);
        let accessCodeDisplay = log.code_used || 'N/A';
        if (log.code_used === '_LBE_') accessCodeDisplay = 'Bouton (L)';
        else if (log.code_used === '') accessCodeDisplay = 'Bouton (S)';

        const logHtml = `
            <div class="log-entry status-${log.status || 'default'}">
                <div class="log-icon" title="${sanitizeHTML(enhancedDescription)}">
                    <i class="${logIconClass}"></i>
                </div>
                <div class="log-details">
                    <div class="log-main">
                        <span class="log-event-text">${sanitizeHTML(enhancedDescription)}</span>
                        <span class="log-time">${formatDateTime(log.timestamp)}</span>
                    </div>
                    <div class="log-secondary">
                        <span class="log-agent" title="Agent/Source"><i class="bi bi-person-fill"></i> ${sanitizeHTML(log.agent || 'Sconosciuto')}</span>
                        <span class="log-code" title="Code utilisé"><i class="bi bi-hash"></i> ${sanitizeHTML(accessCodeDisplay)}</span>
                         <span class="log-ip" title="Adresse IP"><i class="bi bi-pc-display"></i> ${sanitizeHTML(log.ip_address || 'N/D')}</span>
                    </div>
                    ${log.reason && log.reason !== "null" && log.reason.trim() !== "" ? `
                        <div class="log-reason" title="Raison/Détail">
                            <i class="bi bi-chat-left-text"></i> ${sanitizeHTML(formatReason(log.reason))}
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
        logsContainer.innerHTML += logHtml;
    });

    if (paginationContainer && data.pagination) {
        updatePagination(paginationContainer, data.pagination, 'logs_page', currentPageAlerts || '1');
    } else if (paginationContainer) {
        paginationContainer.innerHTML = '';
    }
}

function updateAlertsUI(data, currentPageAlerts, currentPageLogs) {
    const alertsContainer = DOM.alertEntriesContainer;
    const paginationContainer = DOM.alertPaginationContainer;

    if (!alertsContainer) { return; }
    alertsContainer.innerHTML = '';

    if (DOM.alertCounter) {
        DOM.alertCounter.textContent = `${data.alerts ? data.alerts.length : 0} non résolue${(data.alerts && data.alerts.length !== 1) ? 's' : ''}`;
    }

    if (!data.alerts || data.alerts.length === 0) {
        alertsContainer.innerHTML = `<div class="empty-state"><i class="bi bi-shield-check-fill"></i><p>Nessun allarme attivo</p></div>`;
        if (paginationContainer) paginationContainer.innerHTML = '';
        return;
    }

    data.alerts.forEach((alert) => {
        const alertHtml = `
            <div class="alert-entry severity-${alert.severity.toLowerCase()}" data-alert-index="${alert._index}">
                <div class="alert-icon"><i class="bi bi-exclamation-triangle-fill"></i></div>
                <div class="alert-content">
                    <div class="alert-header">
                        <span class="alert-title">${sanitizeHTML(formatAlertType(alert.type))}</span>
                        <span class="alert-severity severity-text-${alert.severity.toLowerCase()}">${sanitizeHTML(alert.severity.charAt(0).toUpperCase() + alert.severity.slice(1))}</span>
                    </div>
                    <p class="alert-message">${sanitizeHTML(alert.message)}</p>
                    <div class="alert-footer">
                        <span class="alert-time">${formatDateTime(alert.timestamp)}</span>
                        <button class="btn btn-sm btn-resolve resolve-btn" data-alert-index="${alert._index}">
                            <i class="bi bi-check-circle-fill"></i> Risolvi
                        </button>
                    </div>
                </div>
            </div>
        `;
        alertsContainer.innerHTML += alertHtml;
    });
     if (paginationContainer && data.pagination) {
        updatePagination(paginationContainer, data.pagination, 'alerts_page', currentPageLogs || '1');
    } else if (paginationContainer) {
        paginationContainer.innerHTML = '';
    }
}

function updatePagination(container, pagination, pageParam, otherPageParamValue) {
    const currentPage = parseInt(pagination.page, 10);
    const totalPages = parseInt(pagination.pages, 10);
    const otherPageKey = pageParam === 'logs_page' ? 'alerts_page' : 'logs_page';

    if (totalPages <= 1) {
        container.innerHTML = ''; return;
    }
    let paginationHtml = `<ul class="pagination justify-content-center">`;
    paginationHtml += `<li class="page-item ${currentPage === 1 ? 'disabled' : ''}"><a class="page-link" href="?${pageParam}=${currentPage - 1}&${otherPageKey}=${otherPageParamValue}" aria-label="Précédent"><i class="bi bi-chevron-left"></i></a></li>`;

    const MAX_PAGES_SHOWN = 3;
    let startLoop = Math.max(1, currentPage - Math.floor(MAX_PAGES_SHOWN / 2));
    let endLoop = Math.min(totalPages, startLoop + MAX_PAGES_SHOWN - 1);

    if (endLoop === totalPages && (endLoop - startLoop + 1) < MAX_PAGES_SHOWN ) {
        startLoop = Math.max(1, totalPages - MAX_PAGES_SHOWN + 1);
    }
     if (startLoop === 1 && totalPages > MAX_PAGES_SHOWN) {
         endLoop = MAX_PAGES_SHOWN;
    }

    if (startLoop > 1) {
        paginationHtml += `<li class="page-item"><a class="page-link" href="?${pageParam}=1&${otherPageKey}=${otherPageParamValue}">1</a></li>`;
        if (startLoop > 2) paginationHtml += `<li class="page-item disabled"><span class="page-link">...</span></li>`;
    }

    for (let i = startLoop; i <= endLoop; i++) {
        paginationHtml += `<li class="page-item ${i === currentPage ? 'active' : ''}"><a class="page-link" href="?${pageParam}=${i}&${otherPageKey}=${otherPageParamValue}">${i}</a></li>`;
    }

    if (endLoop < totalPages) {
        if (endLoop < totalPages - 1) paginationHtml += `<li class="page-item disabled"><span class="page-link">...</span></li>`;
        paginationHtml += `<li class="page-item"><a class="page-link" href="?${pageParam}=${totalPages}&${otherPageKey}=${otherPageParamValue}">${totalPages}</a></li>`;
    }
    paginationHtml += `<li class="page-item ${currentPage === totalPages ? 'disabled' : ''}"><a class="page-link" href="?${pageParam}=${currentPage + 1}&${otherPageKey}=${otherPageParamValue}" aria-label="Suivant"><i class="bi bi-chevron-right"></i></a></li>`;
    paginationHtml += `</ul>`;
    container.innerHTML = paginationHtml;
}

function setupPagination(cardSelector, pageParam, loadFunction) {
    const card = document.querySelector(cardSelector);
    if (!card) return;
    const paginationContainer = card.querySelector('.pagination-container');
    if (!paginationContainer) return;

    paginationContainer.addEventListener('click', function (e) {
        const targetLink = e.target.closest('a.page-link');
        if (!targetLink || targetLink.closest('.page-item.disabled') || targetLink.closest('.page-item.active')) {
             if (targetLink && (targetLink.closest('.page-item.disabled') || targetLink.closest('.page-item.active'))) e.preventDefault();
            return;
        }
        e.preventDefault();
        const href = targetLink.getAttribute('href');
        if (!href || href === '#') return;

        try {
            const url = new URL(href, window.location.origin);
            const page = url.searchParams.get(pageParam);
            const currentUrlParams = new URLSearchParams(window.location.search);
            const otherPageKey = pageParam === 'logs_page' ? 'alerts_page' : 'logs_page';
            const otherPageValue = currentUrlParams.get(otherPageKey) || '1';

            if (page) {
                loadFunction(page, otherPageValue);
                const newUrl = new URL(window.location);
                newUrl.searchParams.set(pageParam, page);
                newUrl.searchParams.set(otherPageKey, otherPageValue);
                window.history.pushState({path: newUrl.toString()}, '', newUrl.toString());
                const entriesContainer = card.querySelector('.log-entries, .alert-entries');
                if(entriesContainer) { entriesContainer.style.opacity = '0.5'; setTimeout(() => { entriesContainer.style.opacity = '1'; }, 300); }
            }
        } catch (error) { console.error("Erreur de pagination:", error); }
    });
}

function loadLogs(page, alertsPageValue) {
    alertsPageValue = alertsPageValue || new URLSearchParams(window.location.search).get('alerts_page') || '1';
    fetchData(`/api/logs?page=${page}&per_page=5`)
        .then(data => updateLogsUI(data, page, alertsPageValue))
        .catch(error => {
            console.error('Erreur chargement logs:', error);
            if(DOM.logEntriesContainer) DOM.logEntriesContainer.innerHTML = `<div class="empty-state text-danger"><i class="bi bi-wifi-off"></i><p>Errore nel caricamento dei log.</p></div>`;
            if(DOM.logPaginationContainer) DOM.logPaginationContainer.innerHTML = '';
        });
}

function loadAlerts(page, logsPageValue) {
    logsPageValue = logsPageValue || new URLSearchParams(window.location.search).get('logs_page') || '1';
    fetchData(`/api/alerts?page=${page}&per_page=5&show_resolved=false`)
        .then(data => updateAlertsUI(data, page, logsPageValue))
        .catch(error => {
            console.error('Erreur chargement alertes:', error);
            if(DOM.alertEntriesContainer) DOM.alertEntriesContainer.innerHTML = `<div class="empty-state text-danger"><i class="bi bi-wifi-off"></i><p>Errore nel caricamento degli allarmi.</p></div>`;
            if(DOM.alertPaginationContainer) DOM.alertPaginationContainer.innerHTML = '';
        });
}

async function handleAlertResolve(button) {
    const alertIndex = button.dataset.alertIndex;
    if (alertIndex === undefined || alertIndex === null) {
        showNotification("Erreur : Index d'alerte manquant.", "error"); return;
    }
    const alertItem = button.closest('.alert-entry');
    if (!alertItem) return;

    button.disabled = true;
    const originalHtml = button.innerHTML;
    button.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>';

    try {
        const response = await fetch(`/api/alert/${alertIndex}/resolve`, { //
            method: 'POST',
            headers: getRequestHeaders(),
            credentials: 'same-origin',
            signal: AbortSignal.timeout(CONFIG.apiTimeout)
        });
        if (!response.ok) throw await handleApiError(response);
        showNotification(`Allarme contrassegnato come risolto.`, 'success');
        alertItem.style.transition = 'opacity 0.3s ease, transform 0.3s ease, max-height 0.3s ease .1s, padding 0.3s ease .1s, margin 0.3s ease .1s, border 0.3s ease .1s';
        alertItem.style.opacity = '0'; alertItem.style.transform = 'translateX(20px)';
        alertItem.style.maxHeight = '0px'; alertItem.style.paddingTop = '0'; alertItem.style.paddingBottom = '0';
        alertItem.style.marginTop = '0'; alertItem.style.marginBottom = '0'; alertItem.style.borderWidth = '0';
        setTimeout(() => {
            alertItem.remove();
            const currentUrlParams = new URLSearchParams(window.location.search);
            loadAlerts(currentUrlParams.get('alerts_page') || '1', currentUrlParams.get('logs_page') || '1');
        }, 400);
    } catch (error) {
        console.error('Erreur résolution alerte:', error);
        showNotification(error.message || 'Erreur lors de la résolution.', 'error');
        button.innerHTML = originalHtml; button.disabled = false;
    }
}

function updateLastRefreshTime() {
    if (DOM.updateTimeElement) {
        DOM.updateTimeElement.textContent = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
}
function getRequestHeaders() { return { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }; }
async function fetchData(endpoint) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONFIG.apiTimeout);
    try {
        const response = await fetch(endpoint, {
            headers: { 'X-Requested-With': 'XMLHttpRequest' },
            credentials: 'same-origin',
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (!response.ok) {
            if(response.status === 0 || response.type === 'opaque' || response.type === 'error') throw new Error('Erreur réseau ou CORS');
            const errorText = await response.text().catch(() => 'Réponse d_erreur non lisible');
            console.error("Erreur API:", response.status, errorText);
            throw new Error(`Erreur HTTP: ${response.status} - ${errorText.substring(0,100)}`);
        }
        return await response.json();
    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            console.warn(`Timeout pour ${endpoint}`);
            throw new Error(`Timeout de la requête API (${endpoint.split('?')[0]})`);
        }
        console.error(`Erreur Fetch pour ${endpoint}:`, error);
        throw error;
    }
}
async function handleApiError(response) {
    try {
        const errorData = await response.json();
        return new Error(errorData.error || errorData.message || `Échec de la requête API (${response.status})`);
    } catch {
        return new Error(`Erreur serveur ou réponse non JSON (${response.status})`);
    }
}
function isCodeValid(code) {
    if (!code?.valid_until) return false;
    try { return new Date(code.valid_until) > new Date(); }
    catch (e) { console.error('Erreur vérification validité code:', e, code.valid_until); return false; }
}
function formatReason(reason) { return reason ? reason.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : ''; }
function formatAlertType(type) {  return type ? type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : ''; }
function sanitizeHTML(str) { if (str === null || str === undefined) return ''; const temp = document.createElement('div'); temp.textContent = String(str); return temp.innerHTML; }

function showNotification(message, type = 'info', duration = 4000) {
    message = sanitizeHTML(message);
    const container = document.getElementById('toast-container') || createToastContainer();
    const toast = document.createElement('div');
    let bgColorClass = 'bg-primary'; let textColorClass = 'text-white';
    if (type === 'success') bgColorClass = 'bg-success';
    else if (type === 'warning') { bgColorClass = 'bg-warning'; textColorClass = 'text-dark';}
    else if (type === 'error') bgColorClass = 'bg-danger';
    else if (type === 'info') { bgColorClass = 'bg-info'; textColorClass = 'text-dark'; }

    toast.className = `toast align-items-center ${textColorClass} ${bgColorClass} border-0 shadow-lg`; // Ajout de shadow-lg
    toast.setAttribute('role', 'alert'); toast.setAttribute('aria-live', 'assertive'); toast.setAttribute('aria-atomic', 'true');

    toast.innerHTML = `
        <div class="d-flex">
            <div class="toast-body">${message.replace(/\n/g, '<br>')}</div>
            <button type="button" class="btn-close ${textColorClass === 'text-white' ? 'btn-close-white' : ''} me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
        </div>
    `;
    container.appendChild(toast);
    const bsToast = new bootstrap.Toast(toast, { delay: duration, autohide: true });
    try { bsToast.show(); } catch(e) { console.error("Erreur affichage toast:", e); toast.remove(); }
    toast.addEventListener('hidden.bs.toast', () => toast.remove());
}

function createToastContainer() {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'position-fixed bottom-0 end-0 p-3';
        container.style.zIndex = "1100";
        document.body.appendChild(container);
    }
    return container;
}

function resetGenerateButton(isError = false) {
     if (!DOM.generateBtn) return;
    DOM.generateBtn.disabled = false;
    DOM.generateBtn.innerHTML = isError
        ? '<i class="bi bi-exclamation-triangle-fill me-1"></i> Riprova'
        : '<i class="bi bi-plus-circle-fill"></i> Genera un Nuovo Codice'; // Icône remplie
}
function formatDateTime(timestamp) {
    if (!timestamp) return 'N/A';
    try {
        const date = new Date(timestamp);
        if (isNaN(date.getTime())) { return 'Date invalide'; }
        return date.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch (e) { console.error("Erreur de formatage de date:", e, "pour le timestamp:", timestamp); return 'Erreur date'; }
}
function handleFooterLayout() {
    const footer = document.querySelector('.dashboard-footer');
    if (footer) {
        footer.style.padding = window.innerWidth < 768 ? '0.8rem 0' : '1rem 0';
    }
}
window.addEventListener('resize', handleFooterLayout);