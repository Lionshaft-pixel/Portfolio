const repositories = [
    {
        name: "SparX",
        description: "An AI Assistant for learning and explanations. Provides intelligent tutoring and detailed explanations across various subjects.",
        url: "uh-oh.html",
        icon: "fas fa-robot",
        preview: "sparx_preview1.jpg"
    },
    {
        name: "UtilityStack",
        description: "The marketplace for unfinished projects. Turn your abandoned code into cash and give it a second life.",
        url: "https://github.com/Lionshaft-pixel/UtilityStack",
        icon: "fas fa-layer-group",
        preview: "utilitystack_preview1.jpg"
    },
    {
        name: "Scalpel",
        description: "A powerful, browser-based bulk file renaming tool with a wide range of customization options.",
        url: "https://github.com/Lionshaft-pixel/Scalpel",
        icon: "fas fa-cut",
        preview: "scalpel_preview1.jpg"
    },
    {
        name: "Andromeda-Browser",
        description: "A modern, lightweight browser powered by Chromium with enhanced privacy features.",
        url: "https://github.com/Lionshaft-pixel/Andromeda-Browser",
        icon: "fas fa-compass",
        preview: "andromeda_preview1.jpg"
    },
    {
        name: "Greeting Clock",
        description: "A page with live clock",
        url: "https://github.com/Lionshaft-pixel/Greeting-clock",
        icon: "fas fa-clock",
        preview: "greeting-clock_preview1.jpg"
    },
    {
        name: "Terminal Calculator",
        description: "I made a simple commandline calculator built in Python. This project shows the evolution of my coding skills from beginner to pro level.",
        url: "https://github.com/Lionshaft-pixel/Terminal-Calculator",
        icon: "fas fa-calculator",
        preview: "calculator_preview1.jpg"
    }
];

const entryScreen = document.getElementById('entryScreen');
const mainContent = document.getElementById('mainContent');
const reposGrid = document.getElementById('reposGrid');

function loadRepositories() {
    reposGrid.innerHTML = '';
    
    repositories.forEach(repo => {
        const repoCard = document.createElement('div');
        repoCard.className = 'repo-card';
        const previewMarkup = repo.preview
            ? `<a class="repo-preview" href="${repo.preview}" target="_blank" rel="noopener">
                    <img src="${repo.preview}" alt="${repo.name} preview">
               </a>`
            : '';
        repoCard.innerHTML = `
            <div class="repo-icon">
                <i class="${repo.icon}"></i>
            </div>
            <h3 class="repo-title">${repo.name}</h3>
            <p class="repo-description">${repo.description}</p>
            ${previewMarkup}
            <a href="${repo.url}" target="_blank" class="repo-link">
                View Repository <i class="fas fa-arrow-right"></i>
            </a>
        `;
        
        repoCard.addEventListener('click', (e) => {
            if (e.target.closest('a')) {
                return;
            }
            window.open(repo.url, '_blank');
        });

        const previewLink = repoCard.querySelector('.repo-preview');
        if (previewLink) {
            previewLink.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                window.open(repo.preview, '_blank');
            });
        }

        const repoLink = repoCard.querySelector('.repo-link');
        if (repoLink) {
            repoLink.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        }
        
        reposGrid.appendChild(repoCard);
    });
}

function createParticle(x, y) {
    const particle = document.createElement('div');
    particle.className = 'click-particle';
    
    const angle = Math.random() * Math.PI * 2;
    const distance = 30 + Math.random() * 70;
    const tx = Math.cos(angle) * distance;
    const ty = Math.sin(angle) * distance;
    
    particle.style.setProperty('--tx', `${tx}px`);
    particle.style.setProperty('--ty', `${ty}px`);
    particle.style.left = `${x}px`;
    particle.style.top = `${y}px`;
    
    document.body.appendChild(particle);
    
    particle.animate([
        { transform: 'translate(-50%, -50%) scale(0)', opacity: 1 },
        { transform: `translate(${tx}px, ${ty}px) scale(1)`, opacity: 0 }
    ], {
        duration: 800,
        easing: 'cubic-bezier(0.2, 0, 0.8, 1)'
    });
    
    setTimeout(() => {
        if (particle.parentNode) {
            particle.parentNode.removeChild(particle);
        }
    }, 800);
}

function initializeServoControls() {
    const servoSlider = document.getElementById('servoSlider');
    const angleDisplay = document.getElementById('angleDisplay');
    const leftBtn = document.getElementById('leftBtn');
    const centerBtn = document.getElementById('centerBtn');
    const rightBtn = document.getElementById('rightBtn');
    const syncStreamBtn = document.getElementById('syncStreamBtn');
    const liveStream = document.getElementById('liveStream');
    const controlStatus = document.getElementById('controlStatus');

    if (!servoSlider || !angleDisplay || !controlStatus) {
        return;
    }

    const API_ENDPOINT = getServoApiEndpoint();
    const ERROR_SUFFIX = "I guess my website is broken for now, but dw, I'll fix it soon";
    const MIN_SEND_INTERVAL = 45;
    let inFlight = false;
    let queuedValue = null;
    let pendingTimer = null;
    let lastSendStartedAt = 0;

    function sliderValueToDisplayValue() {
        const percent = Number(servoSlider.value || 0);
        return Math.max(0, Math.min(100, percent)) / 100;
    }

    function sliderValueToServoValue() {
        return sliderValueToDisplayValue() - 1;
    }

    function servoValueToDisplayValue(value) {
        return Math.max(0, Math.min(1, value + 1));
    }

    function updateDisplay() {
        angleDisplay.textContent = sliderValueToDisplayValue().toFixed(2);
    }

    function setStatus(message, type = '') {
        controlStatus.textContent = message;
        controlStatus.className = `control-status ${type}`.trim();
    }

    async function sendServoValue(value) {
        try {
            setStatus(`Moving to ${servoValueToDisplayValue(value).toFixed(2)}...`);
            
            const response = await fetch(API_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ value })
            });

            let data = {};
            let rawText = '';
            try {
                rawText = await response.text();
                data = rawText ? JSON.parse(rawText) : {};
            } catch (error) {
                data = {};
            }
            
            if (!response.ok) {
                const source = data.source ? ` (${data.source})` : '';
                const details = data.error || data.message || rawText || `HTTP ${response.status}`;
                throw new Error(`${details}${source}`);
            }

            setStatus(data.message || 'Command sent successfully', 'success');
            return true;
        } catch (error) {
            setStatus(`Error: ${error.message}. ${ERROR_SUFFIX}`, 'error');
            return false;
        }
    }

    function queueServoSend() {
        updateDisplay();
        dispatchServoValue(sliderValueToServoValue());
    }

    function dispatchServoValue(value) {
        queuedValue = value;

        if (inFlight) {
            setStatus(`Moving to ${servoValueToDisplayValue(value).toFixed(2)}...`);
            return;
        }

        flushServoQueue();
    }

    function flushServoQueue() {
        if (inFlight || queuedValue === null) {
            return;
        }

        const delay = Math.max(0, MIN_SEND_INTERVAL - (Date.now() - lastSendStartedAt));

        window.clearTimeout(pendingTimer);
        pendingTimer = window.setTimeout(() => {
            if (inFlight || queuedValue === null) {
                return;
            }

            const value = queuedValue;
            queuedValue = null;
            inFlight = true;
            lastSendStartedAt = Date.now();

            sendServoValue(value).finally(() => {
                inFlight = false;
                flushServoQueue();
            });
        }, delay);
    }

    function moveTo(percent) {
        servoSlider.value = String(percent);
        queueServoSend();
    }

    function syncLiveStream() {
        if (!liveStream) {
            return;
        }

        const streamUrl = new URL('https://noah.watch/stream');
        streamUrl.searchParams.set('sync', String(Date.now()));
        liveStream.src = streamUrl.toString();
        setStatus('Stream synced to latest.', 'success');
    }

    updateDisplay();
    fetch(`${API_ENDPOINT}?warm=1`, { cache: 'no-store' }).catch(() => {});
    servoSlider.addEventListener('input', queueServoSend);
    if (leftBtn) leftBtn.addEventListener('click', () => moveTo(0));
    if (centerBtn) centerBtn.addEventListener('click', () => moveTo(50));
    if (rightBtn) rightBtn.addEventListener('click', () => moveTo(100));
    if (syncStreamBtn) syncStreamBtn.addEventListener('click', syncLiveStream);
}

function getServoApiEndpoint() {
    const vercelApiEndpoint = 'https://project-a7soe.vercel.app/api/servo';
    const hostname = window.location.hostname;
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
    const isVercel = hostname.endsWith('.vercel.app');

    if (isLocal || isVercel) {
        return '/api/servo';
    }

    return vercelApiEndpoint;
}

function handleEntryClick(e) {
    createParticle(e.clientX, e.clientY);
    
    entryScreen.style.transition = 'opacity 0.8s cubic-bezier(0.4, 0, 0.2, 1), transform 1s cubic-bezier(0.4, 0, 0.2, 1)';
    entryScreen.style.opacity = '0';
    entryScreen.style.transform = 'scale(1.2)';
    
    setTimeout(() => {
        entryScreen.style.display = 'none';
        
        mainContent.style.display = 'block';
        setTimeout(() => {
            mainContent.style.transition = 'opacity 0.8s ease 0.2s, transform 0.8s ease 0.2s';
            mainContent.style.opacity = '1';
            mainContent.style.transform = 'translateY(0)';
            
            initializeServoControls();
        }, 50);
    }, 800);
    
    document.removeEventListener('click', handleEntryClick);
    document.removeEventListener('keydown', handleKeyPress);
}

function handleKeyPress(e) {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        handleEntryClick({clientX: window.innerWidth/2, clientY: window.innerHeight/2});
    }
}

function handleStreamError(img) {
    img.style.display = 'none';
    const wrapper = img.parentElement;
    wrapper.innerHTML = `
        <div class="livestream-error-box">
            <i class="fas fa-exclamation-circle"></i>
            <h3>Stream Unavailable</h3>
            <p>The livestream could not load. I guess my website is broken for now, but dw, I'll fix it soon</p>
            <a href="https://noah.watch/interactive" target="_blank" rel="noopener" class="view-direct-btn">
                View live stream and controls directly
            </a>
        </div>
    `;
}

document.addEventListener('DOMContentLoaded', () => {
    loadRepositories();
    
    document.addEventListener('click', handleEntryClick);
    document.addEventListener('keydown', handleKeyPress);
    
    const title = document.querySelector('.entry-title');
    let hue = 0;
    setInterval(() => {
        hue = (hue + 0.5) % 360;
        title.style.background = `linear-gradient(45deg, hsl(${hue}, 100%, 65%), #ffffff, hsl(${hue}, 100%, 65%))`;
        title.style.backgroundSize = '200% 200%';
        title.style.webkitBackgroundClip = 'text';
        title.style.backgroundClip = 'text';
    }, 50);
    
    document.addEventListener('click', (e) => {
        if (entryScreen.style.display === 'none') {
            if (Math.random() > 0.7) {
                createParticle(e.clientX, e.clientY);
            }
        }
    });
});
