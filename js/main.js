/* ===================================
   TaskMate - Main JavaScript
   =================================== */

// Font Awesome icons are loaded via CSS, no initialization needed

document.addEventListener('DOMContentLoaded', () => {
    // Loading Screen
    initLoadingScreen();
    
    // Smooth Scroll
    initSmoothScroll();
    
    // Header Scroll
    initHeaderScroll();
    
    // Mobile Menu
    initMobileMenu();
    
    // Animations
    initAnimations();
    
    // Form Handler
    initFormHandler();
    
    // Floating CTA
    initFloatingCTA();
});

// Loading Screen
function initLoadingScreen() {
    const loadingScreen = document.getElementById('loading-screen');
    const loadingBar = document.querySelector('.loading-bar');
    const loadingVideo = document.getElementById('loading-video');
    
    // Start progress bar animation immediately
    setTimeout(() => {
        if (loadingBar) {
            loadingBar.style.width = '100%';
        }
    }, 100);
    
    // Hide loading screen after 4 seconds
    setTimeout(() => {
        if (loadingScreen) {
            loadingScreen.style.transition = 'opacity 0.8s ease';
            loadingScreen.style.opacity = '0';
            
            setTimeout(() => {
                loadingScreen.style.display = 'none';
                // Pause loading video to save resources
                if (loadingVideo) {
                    loadingVideo.pause();
                }
            }, 800);
        }
    }, 4000);
}

// Smooth Scroll
function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                const headerOffset = 80;
                const elementPosition = target.getBoundingClientRect().top;
                const offsetPosition = elementPosition + window.pageYOffset - headerOffset;
                
                window.scrollTo({
                    top: offsetPosition,
                    behavior: 'smooth'
                });
            }
        });
    });
}

// Header Scroll
function initHeaderScroll() {
    let lastScroll = 0;
    window.addEventListener('scroll', () => {
        const header = document.getElementById('header');
        const currentScroll = window.pageYOffset;
        
        if (header) {
            if (currentScroll > 100) {
                header.classList.add('header-scrolled');
            } else {
                header.classList.remove('header-scrolled');
            }
        }
        
        lastScroll = currentScroll;
    });
}

// Mobile Menu
function initMobileMenu() {
    const mobileMenuBtn = document.querySelector('.mobile-menu-btn');
    const nav = document.querySelector('.nav');
    
    if (mobileMenuBtn && nav) {
        mobileMenuBtn.addEventListener('click', () => {
            nav.classList.toggle('nav-open');
            mobileMenuBtn.classList.toggle('active');
        });
    }
}

// Animations
function initAnimations() {
    // Intersection Observer for animations
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -100px 0px'
    };
    
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);
    
    // Observe all fade-in elements
    document.querySelectorAll('.fade-in').forEach(el => {
        observer.observe(el);
    });
    
    // Observe fade-in-up elements
    document.querySelectorAll('.fade-in-up').forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(30px)';
        el.style.transition = 'all 0.8s ease';
        observer.observe(el);
    });
    
    // Add stagger animation for feature cards
    document.querySelectorAll('.feature-card').forEach((card, index) => {
        card.style.transitionDelay = `${index * 0.1}s`;
    });
    
    // Add stagger animation for stat cards
    document.querySelectorAll('.stat-card').forEach((card, index) => {
        card.style.transitionDelay = `${index * 0.1}s`;
    });
    
    // Number counting animation
    initNumberAnimation();
}

// Number counting animation for stats
function initNumberAnimation() {
    function animateNumbers() {
        const statNumbers = document.querySelectorAll('.stat-number');
        statNumbers.forEach(stat => {
            const target = parseInt(stat.dataset.target);
            const suffix = stat.dataset.suffix || '';
            const duration = 2000;
            const start = 0;
            const increment = target / (duration / 16);
            let current = start;
            
            const timer = setInterval(() => {
                current += increment;
                if (current >= target) {
                    current = target;
                    clearInterval(timer);
                }
                stat.innerHTML = Math.floor(current) + '<span style="font-size: 0.5em; font-weight: 600;">' + suffix + '</span>';
            }, 16);
        });
    }
    
    // Trigger number animation when stats section is visible
    const statsSection = document.querySelector('.stats');
    if (statsSection) {
        const statsObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    animateNumbers();
                    statsObserver.unobserve(entry.target);
                }
            });
        }, { threshold: 0.5 });
        statsObserver.observe(statsSection);
    }
}

// Form Submit Handler
function initFormHandler() {
    const forms = document.querySelectorAll('form[onsubmit]');
    forms.forEach(form => {
        form.removeAttribute('onsubmit');
        form.addEventListener('submit', handleSubmit);
    });
}

function handleSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const submitBtn = form.querySelector('button[type="submit"]');
    
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 送信中...';
        
        setTimeout(() => {
            alert('お申し込みありがとうございます！\n担当者より24時間以内にご連絡させていただきます。');
            form.reset();
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> 無料診断を申込む';
        }, 1500);
    }
}

// Floating CTA
function initFloatingCTA() {
    // Floating CTA is now a direct link to LINE, no additional JS needed
    // Keep function for compatibility
}

// Demo Section Functions
function switchDemoView(view) {
    const appView = document.getElementById('app-view');
    const sheetView = document.getElementById('sheet-view');
    const contentWrapper = document.getElementById('demo-content');
    const tabs = document.querySelectorAll('.demo-tab');
    
    // Remove active class from all tabs
    tabs.forEach(tab => tab.classList.remove('active'));
    
    // Add active class to clicked tab
    event.target.closest('.demo-tab').classList.add('active');
    
    switch(view) {
        case 'app':
            // Show only app
            appView.style.display = 'block';
            sheetView.style.display = 'none';
            contentWrapper.classList.remove('split-view');
            break;
        case 'sheet':
            // Show only spreadsheet
            appView.style.display = 'none';
            sheetView.style.display = 'block';
            contentWrapper.classList.remove('split-view');
            break;
        case 'split':
            // Show both side by side
            appView.style.display = 'block';
            sheetView.style.display = 'block';
            contentWrapper.classList.add('split-view');
            break;
    }
}

function toggleFullscreen(type) {
    let demoBrowser;
    let icon;
    
    if (type === 'app') {
        demoBrowser = document.getElementById('app-view');
        icon = demoBrowser.querySelector('.demo-fullscreen-btn i');
    } else if (type === 'sheet') {
        demoBrowser = document.getElementById('sheet-view');
        icon = demoBrowser.querySelector('.demo-fullscreen-btn i');
    }
    
    if (demoBrowser) {
        demoBrowser.classList.toggle('fullscreen');
        
        if (demoBrowser.classList.contains('fullscreen')) {
            icon.classList.remove('fa-expand');
            icon.classList.add('fa-compress');
        } else {
            icon.classList.remove('fa-compress');
            icon.classList.add('fa-expand');
        }
    }
}

// Handle Demo iframe loading
document.addEventListener('DOMContentLoaded', () => {
    const demoIframe = document.getElementById('demo-iframe');
    const sheetIframe = document.getElementById('sheet-iframe');
    const demoWrapper = document.querySelector('#app-view .demo-iframe-wrapper');
    const sheetWrapper = document.querySelector('#sheet-view .demo-iframe-wrapper');
    
    // Handle app iframe
    if (demoIframe) {
        demoIframe.addEventListener('load', () => {
            if (demoWrapper) {
                demoWrapper.classList.add('loaded');
            }
        });
        
        demoIframe.addEventListener('error', () => {
            const loadingDiv = document.getElementById('demo-loading');
            if (loadingDiv) {
                loadingDiv.innerHTML = `
                    <i class="fas fa-exclamation-triangle" style="font-size: 2rem; color: var(--warning);"></i>
                    <p style="margin-top: 1rem; color: var(--gray-600);">デモの読み込みに失敗しました。再度お試しください。</p>
                `;
            }
        });
    }
    
    // Handle spreadsheet iframe
    if (sheetIframe) {
        sheetIframe.addEventListener('load', () => {
            if (sheetWrapper) {
                sheetWrapper.classList.add('loaded');
            }
        });
        
        sheetIframe.addEventListener('error', () => {
            const loadingDiv = document.getElementById('sheet-loading');
            if (loadingDiv) {
                loadingDiv.innerHTML = `
                    <i class="fas fa-exclamation-triangle" style="font-size: 2rem; color: var(--warning);"></i>
                    <p style="margin-top: 1rem; color: var(--gray-600);">スプレッドシートの読み込みに失敗しました。</p>
                `;
            }
        });
    }
    
    // Add keyboard shortcut for fullscreen (ESC to exit)
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const demoBrowser = document.querySelector('.demo-browser.fullscreen');
            if (demoBrowser) {
                toggleFullscreen();
            }
        }
    });
});