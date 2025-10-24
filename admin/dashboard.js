function adminDashboard() {
    return {
        // Authentication
        isAuthenticated: false,
        loginForm: {
            username: '',
            password: ''
        },
        loginError: '',
        loading: false,

        // Dashboard state
        activeTab: 'create',
        stats: {
            totalLinks: 0,
            totalVisits: 0,
            lineUsers: 0,
            conversionRate: 0
        },

        // Create link form
        newLink: {
            name: '',
            utm_source: '',
            utm_medium: '',
            utm_campaign: ''
        },
        createdLink: '',

        // Data
        trackingLinks: [],
        visits: [],
        lineUsers: [],

        // Agency management
        agencies: [],
        filteredAgencies: [],
        agencyFilter: 'all',
        agencyStats: {
            total: 0,
            pending: 0,
            active: 0,
            rejected: 0,
            suspended: 0
        },

        // Configuration - Security Note: Move credentials to environment variables
        config: {
            supabaseUrl: 'https://your-project.supabase.co',
            supabaseKey: 'your-anon-key'
            // adminCredentials removed for security - use server-side validation only
        },

        async init() {
            // Check for existing authentication
            const authToken = localStorage.getItem('trackingAdminAuth');
            if (authToken) {
                this.isAuthenticated = true;
                await this.loadDashboardData();
            }
        },

        async login() {
            this.loading = true;
            this.loginError = '';

            try {
                // サーバーサイドで環境変数を使って認証
                const response = await fetch('/.netlify/functions/validate-admin', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        username: this.loginForm.username,
                        password: this.loginForm.password
                    })
                });

                const result = await response.json();

                if (response.ok && result.success) {
                    this.isAuthenticated = true;
                    localStorage.setItem('trackingAdminAuth', result.token);
                    await this.loadDashboardData();
                } else {
                    this.loginError = result.error || 'ユーザー名またはパスワードが間違っています';
                }
            } catch (error) {
                // Security: Removed client-side fallback authentication
                // All authentication must go through server-side validation
                this.loginError = 'ログイン失敗: サーバーに接続できません。管理者にお問い合わせください。';
                console.error('Authentication error:', error);
            } finally {
                this.loading = false;
            }
        },

        logout() {
            this.isAuthenticated = false;
            localStorage.removeItem('trackingAdminAuth');
            this.loginForm = { username: '', password: '' };
            this.loginError = '';
        },

        async loadDashboardData() {
            try {
                await Promise.all([
                    this.loadStats(),
                    this.loadTrackingLinks()
                ]);
            } catch (error) {
                console.error('Error loading dashboard data:', error);
            }
        },

        async loadStats() {
            try {
                const response = await fetch('/.netlify/functions/get-tracking-stats', {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                    }
                });

                if (response.ok) {
                    const data = await response.json();
                    this.stats = data;
                }
            } catch (error) {
                console.error('Error loading stats:', error);
            }
        },

        async createTrackingLink() {
            this.loading = true;
            try {
                const response = await fetch('/.netlify/functions/create-tracking-link', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(this.newLink)
                });

                if (response.ok) {
                    const data = await response.json();
                    this.createdLink = `https://agency.ikemen.ltd/t/${data.tracking_code}`;
                    this.newLink = {
                        name: '',
                        utm_source: '',
                        utm_medium: '',
                        utm_campaign: ''
                    };
                    await this.loadTrackingLinks();
                    await this.loadStats();
                } else {
                    const error = await response.json();
                    alert('Error creating tracking link: ' + error.message);
                }
            } catch (error) {
                console.error('Error creating tracking link:', error);
                alert('Error creating tracking link: ' + error.message);
            } finally {
                this.loading = false;
            }
        },

        async loadTrackingLinks() {
            try {
                const response = await fetch('/.netlify/functions/get-tracking-stats?type=links');
                if (response.ok) {
                    const data = await response.json();
                    this.trackingLinks = data.links || [];
                }
            } catch (error) {
                console.error('Error loading tracking links:', error);
            }
        },

        async loadVisits() {
            try {
                const response = await fetch('/.netlify/functions/get-tracking-stats?type=visits');
                if (response.ok) {
                    const data = await response.json();
                    this.visits = data.visits || [];
                }
            } catch (error) {
                console.error('Error loading visits:', error);
            }
        },

        async loadLineUsers() {
            try {
                const response = await fetch('/.netlify/functions/get-tracking-stats?type=users');
                if (response.ok) {
                    const data = await response.json();
                    this.lineUsers = data.users || [];
                }
            } catch (error) {
                console.error('Error loading LINE users:', error);
            }
        },

        async copyToClipboard(text) {
            try {
                await navigator.clipboard.writeText(text);

                // Show temporary success message
                const button = event.target;
                const originalText = button.innerHTML;
                button.innerHTML = '<i class="fas fa-check"></i> コピー済み！';
                button.classList.remove('bg-emerald-100', 'hover:bg-emerald-200', 'text-emerald-600');
                button.classList.add('bg-green-100', 'text-green-600');

                setTimeout(() => {
                    button.innerHTML = originalText;
                    button.classList.remove('bg-green-100', 'text-green-600');
                    button.classList.add('bg-emerald-100', 'hover:bg-emerald-200', 'text-emerald-600');
                }, 2000);
            } catch (error) {
                console.error('Failed to copy:', error);
                alert('Failed to copy to clipboard');
            }
        },

        // Agency management methods
        async loadAgencies() {
            this.loading = true;
            try {
                const response = await fetch('/.netlify/functions/admin-agencies', {
                    headers: {
                        'Authorization': `Bearer admin:${localStorage.getItem('trackingAdminAuth')}`
                    }
                });

                if (response.ok) {
                    const data = await response.json();
                    this.agencies = data.agencies || [];
                    this.agencyStats = data.stats || {
                        total: 0,
                        pending: 0,
                        active: 0,
                        rejected: 0,
                        suspended: 0
                    };
                    this.filterAgencies();
                }
            } catch (error) {
                console.error('Error loading agencies:', error);
            } finally {
                this.loading = false;
            }
        },

        filterAgencies() {
            if (this.agencyFilter === 'all') {
                this.filteredAgencies = this.agencies;
            } else {
                this.filteredAgencies = this.agencies.filter(agency =>
                    agency.status === this.agencyFilter
                );
            }
        },

        async approveAgency(agencyId) {
            if (!confirm('この代理店を承認しますか？')) return;
            await this.updateAgencyStatus(agencyId, 'approve');
        },

        async rejectAgency(agencyId) {
            if (!confirm('この代理店を非承認にしますか？')) return;
            await this.updateAgencyStatus(agencyId, 'reject');
        },

        async suspendAgency(agencyId) {
            if (!confirm('この代理店を一時停止しますか？')) return;
            await this.updateAgencyStatus(agencyId, 'suspend');
        },

        async activateAgency(agencyId) {
            if (!confirm('この代理店を再開しますか？')) return;
            await this.updateAgencyStatus(agencyId, 'activate');
        },

        async updateAgencyStatus(agencyId, action) {
            this.loading = true;
            try {
                const response = await fetch('/.netlify/functions/admin-agencies', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer admin:${localStorage.getItem('trackingAdminAuth')}`
                    },
                    body: JSON.stringify({
                        action,
                        agencyId
                    })
                });

                if (response.ok) {
                    const result = await response.json();
                    alert(result.message);
                    await this.loadAgencies();
                } else {
                    const error = await response.json();
                    alert('エラー: ' + error.error);
                }
            } catch (error) {
                console.error('Error updating agency status:', error);
                alert('ステータス更新に失敗しました');
            } finally {
                this.loading = false;
            }
        },

        viewAgencyDetails(agency) {
            alert(`
代理店詳細:
コード: ${agency.code}
会社名: ${agency.company_name}
代理店名: ${agency.name}
担当者: ${agency.owner_name}
メール: ${agency.contact_email}
電話: ${agency.contact_phone}
住所: ${agency.address || 'N/A'}
手数料率: ${agency.commission_rate}%
ステータス: ${this.getStatusLabel(agency.status)}
登録日: ${this.formatDate(agency.created_at)}
            `.trim());
        },

        getStatusLabel(status) {
            const labels = {
                'pending': '承認待ち',
                'active': '承認済み',
                'rejected': '非承認',
                'suspended': '一時停止'
            };
            return labels[status] || status;
        },

        formatDate(dateString) {
            return new Date(dateString).toLocaleDateString('ja-JP', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
        }
    };
}

// Utility functions
function generateTrackingCode() {
    return Math.random().toString(36).substring(2, 8) +
           Math.random().toString(36).substring(2, 8);
}


// Initialize dashboard when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    console.log('TaskMate AI Tracking Dashboard loaded');
});