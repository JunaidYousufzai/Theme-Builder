    (function () {
        // =========================
        // Configuration
        // =========================



        const CONFIG = {
            BTN_ID: "ghl-theme-customizer-btn",
            PANEL_ID: "tc-panel",
            TOOLBAR_ID: "tc-toolbar-top",
            CONTENT_ID: "tc-section-root",
            STYLE_ID: "tc-theme-style",
            PREVIEW_STYLE_ID: "tc-theme-preview",
            // BACKEND_API: "https://theme-customizer-production.up.railway.app/api",
            BACKEND_API: "https://theme-customizer-production.up.railway.app/api",
            ACCESS_API: "https://theme-customizer-production.up.railway.app/api/access/status/",
            AUTH_TOKEN: window.TOKEN,
            CACHE_DURATION: 5 * 60 * 1000, // 5 minutes cache
            DEBOUNCE_DELAY: 300, // ms for preview debouncing
            HB_MS: 1000 // heartbeat (increased to reduce poll frequency)
        };

        // =========================
        // State Management
        // =========================
        const state = {
            btnRef: null,
            panelRef: null,
            currentTheme: null,
            currentLocation: null,
            themes: [],
            isLoading: false,
            isInitialized: false,
            isPreviewing: false,
            previewTheme: null,
            hasThemeBuilderAccess: false,  // Start with NO access
            mountRetryCount: 0,
            MAX_MOUNT_RETRIES: 30,
            // ✅ ADD THIS
        panelWasManuallyOpened: false,
        // Timestamp of last rerun to prevent rapid double-invocations
        lastRerunTimestamp: 0,
        // Timestamp of last heartbeat execution (debounce)
        lastHeartbeat: 0,
            cache: {
                themes: null,
                themesTimestamp: 0,
                currentTheme: null,
                currentThemeTimestamp: 0
            }
        };

        // Common header selectors used by mount helpers (shared globally)
        const headerContainers = [
            '.hl_header--right',
            '.hl_header--icons',
            '.hl_header-controls',
            '.header-controls',
            '[class*="header"][class*="right"]',
            '[class*="header"][class*="control"]',
            '.hl_header .flex.items-center',
            '.hl_header > div:last-child',
            '.hl_header .flex'
        ];

        // =========================
        // Access Control Service
        // =========================


    const accessControlService = {
            async checkThemeBuilderAccess(locationId, isAgency) {
                // Always show in agency accounts
                if (isAgency) {
                    console.log('🏢 Agency account - granting theme builder access automatically');
                    state.hasThemeBuilderAccess = true;
                    return true;
                }

                // For sub-accounts, check API access
                if (!locationId) {
                    console.log('❌ No location ID provided for access check');
                    return false;
                }

                try {
                    const url = `${CONFIG.ACCESS_API}${locationId}`;
                    console.log('🔐 Checking theme builder access for sub-account:', locationId);

                    const response = await fetch(url, {
                        method: 'GET',
                        headers: {
                            'Content-Type': 'application/json',
                            'x-theme-key': CONFIG.AUTH_TOKEN
                        }
                    });

                    if (!response.ok) {
                        console.warn('⚠️ Access check failed:', response.status);
                        return false;
                    }

                    const data = await response.json();
                    console.log('🔐 Access check response:', data);

                    const hasAccess = data.success && 
                                    data.data && 
                                    data.data.themeBuilderAccess === true;

                    state.hasThemeBuilderAccess = hasAccess;

                    if (hasAccess) {
                        console.log('✅ Theme builder access granted for sub-account:', locationId);
                    } else {
                        console.log('❌ Theme builder access denied for sub-account:', locationId);
                    }

                    return hasAccess;

                } catch (error) {
                    console.error('❌ Error checking theme builder access:', error);
                    state.hasThemeBuilderAccess = false;
                    return false;
                }
            },

            shouldShowCustomizer() {
                return state.hasThemeBuilderAccess;
            }
        };
        // =========================
        // Cache Service
        // =========================
        const cacheService = {
            getThemes() {
                // ✅ CRITICAL: Only return cache if it's for the CURRENT location
                if (state.cache.themes &&
                    state.cache.themesLocationId === state.currentLocation?.locationId &&
                    Date.now() - state.cache.themesTimestamp < CONFIG.CACHE_DURATION) {
                    console.log('Using cached themes for location:', state.currentLocation?.locationId);
                    return state.cache.themes;
                }
                return null;
            },

            setThemes(themes) {
                state.cache.themes = themes;
                state.cache.themesTimestamp = Date.now();
                state.cache.themesLocationId = state.currentLocation?.locationId;
                console.log('Cached themes for location:', state.currentLocation?.locationId);
            },

            getCurrentTheme() {
                // ✅ CRITICAL: Only return cache if it's for the CURRENT location
                if (state.cache.currentTheme &&
                    state.cache.currentThemeLocationId === state.currentLocation?.locationId &&
                    Date.now() - state.cache.currentThemeTimestamp < CONFIG.CACHE_DURATION) {
                    console.log('Using cached theme for location:', state.currentLocation?.locationId);
                    return state.cache.currentTheme;
                }
                return null;
            },

            setCurrentTheme(theme) {
                state.cache.currentTheme = theme;
                state.cache.currentThemeTimestamp = Date.now();
                state.cache.currentThemeLocationId = state.currentLocation?.locationId;
                console.log('Cached current theme for location:', state.currentLocation?.locationId);
            },

            clearCache() {
                console.log('Clearing all caches');
                state.cache.themes = null;
                state.cache.themesTimestamp = 0;
                state.cache.themesLocationId = null;
                state.cache.currentTheme = null;
                state.cache.currentThemeTimestamp = 0;
                state.cache.currentThemeLocationId = null;
            }
        };

        // =========================
        // URL Location Service
        // =========================
        // const urlLocationService = {
        //     isAgencyAccount() {
        //         const pathname = window.location.pathname;

        //         // ✅ Explicit exclusion for /accounts
        //         if (pathname === '/accounts') {
        //             return false; // never treat /accounts as agency
        //         }

        //         const agencyPatterns = [
        //             /\/agency_/,
        //             /\/agency-/,
        //             /\/agency[\/?]/,
        //             /^\/agency$/,
        //             /\/agency_dashboard/,
        //             /\/agency_launchpad/
        //         ];
        //         for (let pattern of agencyPatterns) {
        //             if (pattern.test(pathname)) {
        //                 return true;
        //             }
        //         }

        //         const hasLocationPattern = /\/location\//.test(pathname);
        //         if (!hasLocationPattern && pathname.includes('agency')) {
        //             return true;
        //         }

        //         return false;
        //     },
        //     extractSubAccountLocationId() {
        //         const pathname = window.location.pathname;
        //         const subAccountPatterns = [
        //             /\/location\/([a-zA-Z0-9]+)\/page-builder\/[a-zA-Z0-9]+/, // put specific first
        //             /\/location\/([a-zA-Z0-9]+)\/launchpad/,
        //             /\/location\/([a-zA-Z0-9]+)\/dashboard/,
        //             /\/location\/([a-zA-Z0-9]+)\/contacts/,
        //             /\/location\/([a-zA-Z0-9]+)\/workflows/,
        //             /\/location\/([a-zA-Z0-9]+)\/calendar/,
        //             /\/location\/([a-zA-Z0-9]+)\/settings/,
        //             /\/location\/([a-zA-Z0-9]+)\/company/,
        //             /\/location\/([a-zA-Z0-9]+)\/profile/,
        //             /\/location\/([a-zA-Z0-9]+)\/billing/,
        //             /\/location\/([a-zA-Z0-9]+)\/users/,
        //             /\/location\/([a-zA-Z0-9]+)\/$/, // catch‑all last
        //         ];
        //         for (let pattern of subAccountPatterns) {
        //             const match = pathname.match(pattern);
        //             if (match && match[1]) return match[1];
        //         }
        //         const urlParams = new URLSearchParams(window.location.search);
        //         return urlParams.get('locationId') || urlParams.get('location') || null;
        //     },

        //     getAgencyLocationId() {
        //         const domain = window.location.hostname;
        //         const cleanDomain = domain.replace(/^www\./, '').replace(/\./g, '_');
        //         return `agency_${cleanDomain}`;
        //     },

        //     getCurrentLocationName() {
        //         try {
        //             const selectors = [
        //                 '.hl_switcher-loc-name',
        //                 '[data-location-name]',
        //                 '.location-name',
        //                 '.current-location',
        //                 '.agency-name',
        //                 '[class*="agency"]',
        //                 '.hl_header--location-name',
        //                 '.account-name'
        //             ];
        //             for (let selector of selectors) {
        //                 const element = document.querySelector(selector);
        //                 if (element && element.textContent) {
        //                     const name = element.textContent.trim();
        //                     if (name && name.length > 0 && name !== 'GHL' && name !== 'GoHighLevel') {
        //                         return name;
        //                     }
        //                 }
        //             }
        //             return this.isAgencyAccount() ? 'Agency Dashboard' : 'Sub Account';
        //         } catch (error) {
        //             return this.isAgencyAccount() ? 'Agency Dashboard' : 'Sub Account';
        //         }
        //     },

        //     getCurrentLocation() {
        //         const isAgency = this.isAgencyAccount();
        //         if (isAgency) {
        //             const locationId = this.getAgencyLocationId();
        //             return {
        //                 locationId: locationId,
        //                 name: this.getCurrentLocationName(),
        //                 url: window.location.href,
        //                 isAgency: true,
        //                 domain: window.location.hostname,
        //                 type: 'agency'
        //             };
        //         } else {
        //             const locationId = this.extractSubAccountLocationId();
        //             if (!locationId) {
        //                 return {
        //                     locationId: this.getAgencyLocationId(),
        //                     name: 'Agency Dashboard',
        //                     url: window.location.href,
        //                     isAgency: true,
        //                     domain: window.location.hostname,
        //                     type: 'agency_fallback'
        //                 };
        //             }
        //             return {
        //                 locationId: locationId,
        //                 name: this.getCurrentLocationName(),
        //                 url: window.location.href,
        //                 isAgency: false,
        //                 domain: window.location.hostname,
        //                 type: 'sub_account'
        //             };
        //         }
        //     }
        // };

    // =========================
    // URL Location Service - UPDATED
    // =========================
    // const urlLocationService = {
    //     isAgencyAccount() {
    //         const pathname = window.location.pathname;

    //         // ✅ Explicit exclusion for /accounts
    //         if (pathname === '/accounts') {
    //             return false; // never treat /accounts as agency
    //         }

    //         const agencyPatterns = [
    //             /\/agency_/,
    //             /\/agency-/,
    //             /\/agency[\/?]/,
    //             /^\/agency$/,
    //             /\/agency_dashboard/,
    //             /\/agency_launchpad/
    //         ];
    //         for (let pattern of agencyPatterns) {
    //             if (pattern.test(pathname)) {
    //                 return true;
    //             }
    //         }

    //         const hasLocationPattern = /\/location\//.test(pathname);
    //         if (!hasLocationPattern && pathname.includes('agency')) {
    //             return true;
    //         }

    //         return false;
    //     },
        
    //     extractSubAccountLocationId() {
    //         const pathname = window.location.pathname;
    //         const subAccountPatterns = [
    //             /\/location\/([a-zA-Z0-9]+)\/page-builder\/[a-zA-Z0-9]+/, // put specific first
    //             /\/location\/([a-zA-Z0-9]+)\/launchpad/,
    //             /\/location\/([a-zA-Z0-9]+)\/dashboard/,
    //             /\/location\/([a-zA-Z0-9]+)\/contacts/,
    //             /\/location\/([a-zA-Z0-9]+)\/workflows/,
    //             /\/location\/([a-zA-Z0-9]+)\/calendar/,
    //             /\/location\/([a-zA-Z0-9]+)\/settings/,
    //             /\/location\/([a-zA-Z0-9]+)\/company/,
    //             /\/location\/([a-zA-Z0-9]+)\/profile/,
    //             /\/location\/([a-zA-Z0-9]+)\/billing/,
    //             /\/location\/([a-zA-Z0-9]+)\/users/,
    //             /\/location\/([a-zA-Z0-9]+)\/$/, // catch‑all last
    //         ];
    //         for (let pattern of subAccountPatterns) {
    //             const match = pathname.match(pattern);
    //             if (match && match[1]) return match[1];
    //         }
    //         const urlParams = new URLSearchParams(window.location.search);
    //         return urlParams.get('locationId') || urlParams.get('location') || null;
    //     },

    //     getAgencyLocationId() {
    //         const domain = window.location.hostname;
    //         const cleanDomain = domain.replace(/^www\./, '').replace(/\./g, '_');
    //         return `agency_${cleanDomain}`;
    //     },

    //     getCurrentLocationName() {
    //         try {
    //             const selectors = [
    //                 '.hl_switcher-loc-name',
    //                 '[data-location-name]',
    //                 '.location-name',
    //                 '.current-location',
    //                 '.agency-name',
    //                 '[class*="agency"]',
    //                 '.hl_header--location-name',
    //                 '.account-name'
    //             ];
    //             for (let selector of selectors) {
    //                 const element = document.querySelector(selector);
    //                 if (element && element.textContent) {
    //                     const name = element.textContent.trim();
    //                     if (name && name.length > 0 && name !== 'GHL' && name !== 'GoHighLevel') {
    //                         return name;
    //                     }
    //                 }
    //             }
    //             return this.isAgencyAccount() ? 'Agency Dashboard' : 'Sub Account';
    //         } catch (error) {
    //             return this.isAgencyAccount() ? 'Agency Dashboard' : 'Sub Account';
    //         }
    //     },

    //     getCurrentLocation() {
    //         const pathname = window.location.pathname;
            
    //         // ✅ CRITICAL: If we're on /prospecting, return null to disable customizer
    //         if (pathname === '/prospecting' || pathname.startsWith('/prospecting/')) {
    //             return null;
    //         }
            
    //         const isAgency = this.isAgencyAccount();
    //         if (isAgency) {
    //             const locationId = this.getAgencyLocationId();
    //             return {
    //                 locationId: locationId,
    //                 name: this.getCurrentLocationName(),
    //                 url: window.location.href,
    //                 isAgency: true,
    //                 domain: window.location.hostname,
    //                 type: 'agency'
    //             };
    //         } else {
    //             const locationId = this.extractSubAccountLocationId();
    //             if (!locationId) {
    //                 return {
    //                     locationId: this.getAgencyLocationId(),
    //                     name: 'Agency Dashboard',
    //                     url: window.location.href,
    //                     isAgency: true,
    //                     domain: window.location.hostname,
    //                     type: 'agency_fallback'
    //                 };
    //             }
    //             return {
    //                 locationId: locationId,
    //                 name: this.getCurrentLocationName(),
    //                 url: window.location.href,
    //                 isAgency: false,
    //                 domain: window.location.hostname,
    //                 type: 'sub_account'
    //             };
    //         }
    //     }
    // };




    const urlLocationService = {
        isAgencyAccount() {
            const pathname = window.location.pathname;

            // ✅ FIRST: Check if it's a sub-account URL (most important)
            // If it has /location/ID/ pattern, it's NOT agency
            if (/\/location\/[^\/]+\//.test(pathname)) {
                return false; // This is a sub-account
            }

            // ✅ Check for agency patterns (treat /accounts as agency)
            const agencyPatterns = [
                /\/agency_/,
                /\/agency-/,
                /^\/agency[\/?]/,
                /^\/agency$/,
                /\/agency_dashboard/,
                /\/agency_launchpad/,
                /\/dashboard$/,
                /^\/$/, // root path
                /\/settings$/,
                /\/billing$/,
                /\/accounts(\/|$)/
            ];
            
            for (let pattern of agencyPatterns) {
                if (pattern.test(pathname)) {
                    return true;
                }
            }

            // ✅ If path doesn't have /location/ but has 'agency', it's agency
            const hasLocationPattern = /\/location\//.test(pathname);
            if (!hasLocationPattern && pathname.includes('agency')) {
                return true;
            }

            return false;
        },
        
        extractSubAccountLocationId() {
            const pathname = window.location.pathname;
            
            // ✅ FIXED: Added /opportunities/ and support for v2 paths
            const subAccountPatterns = [
                /\/location\/([a-zA-Z0-9]+)\/page-builder\/[a-zA-Z0-9]+/,
                /\/location\/([a-zA-Z0-9]+)\/launchpad/,
                /\/location\/([a-zA-Z0-9]+)\/dashboard/,
                /\/location\/([a-zA-Z0-9]+)\/contacts/,
                /\/location\/([a-zA-Z0-9]+)\/workflows/,
                /\/location\/([a-zA-Z0-9]+)\/calendar/,
                /\/location\/([a-zA-Z0-9]+)\/settings/,
                /\/location\/([a-zA-Z0-9]+)\/company/,
                /\/location\/([a-zA-Z0-9]+)\/profile/,
                /\/location\/([a-zA-Z0-9]+)\/billing/,
                /\/location\/([a-zA-Z0-9]+)\/users/,
                /\/location\/([a-zA-Z0-9]+)\/opportunities/, // ✅ ADDED THIS
                /\/v2\/location\/([a-zA-Z0-9]+)\//, // ✅ ADDED for v2 paths
                /\/location\/([a-zA-Z0-9]+)\// // catch-all last
            ];
            
            for (let pattern of subAccountPatterns) {
                const match = pathname.match(pattern);
                if (match && match[1]) return match[1];
            }
            
            const urlParams = new URLSearchParams(window.location.search);
            return urlParams.get('locationId') || urlParams.get('location') || null;
        },

        getAgencyLocationId() {
            const domain = window.location.hostname;
            const cleanDomain = domain.replace(/^www\./, '').replace(/\./g, '_');
            return `agency_${cleanDomain}`;
        },

        getCurrentLocationName() {
            try {
                const selectors = [
                    '.hl_switcher-loc-name',
                    '[data-location-name]',
                    '.location-name',
                    '.current-location',
                    '.agency-name',
                    '[class*="agency"]',
                    '.hl_header--location-name',
                    '.account-name'
                ];
                for (let selector of selectors) {
                    const element = document.querySelector(selector);
                    if (element && element.textContent) {
                        const name = element.textContent.trim();
                        if (name && name.length > 0 && name !== 'GHL' && name !== 'GoHighLevel') {
                            return name;
                        }
                    }
                }
                return this.isAgencyAccount() ? 'Agency Dashboard' : 'Sub Account';
            } catch (error) {
                return this.isAgencyAccount() ? 'Agency Dashboard' : 'Sub Account';
            }
        },

        getCurrentLocation() {
            const pathname = window.location.pathname;
            
            // ✅ CRITICAL: If we're on /prospecting, return null to disable customizer
            if (pathname === '/prospecting' || pathname.startsWith('/prospecting/')) {
                return null;
            }
            
            const isAgency = this.isAgencyAccount();
            if (isAgency) {
                const locationId = this.getAgencyLocationId();
                return {
                    locationId: locationId,
                    name: this.getCurrentLocationName(),
                    url: window.location.href,
                    isAgency: true,
                    domain: window.location.hostname,
                    type: 'agency'
                };
            } else {
                const locationId = this.extractSubAccountLocationId();
                if (!locationId) {
                    return {
                        locationId: this.getAgencyLocationId(),
                        name: 'Agency Dashboard',
                        url: window.location.href,
                        isAgency: true,
                        domain: window.location.hostname,
                        type: 'agency_fallback'
                    };
                }
                return {
                    locationId: locationId,
                    name: this.getCurrentLocationName(),
                    url: window.location.href,
                    isAgency: false,
                    domain: window.location.hostname,
                    type: 'sub_account'
                };
            }
        }
    };

        // =========================
        // API Service
        // =========================
        const apiService = {
            async call(endpoint, options = {}) {
                const url = `${CONFIG.BACKEND_API}${endpoint}`;
                const headers = {
                    'Content-Type': 'application/json',
                    'x-theme-key': CONFIG.AUTH_TOKEN,
                    ...options.headers
                };

                const config = {
                    method: options.method || 'GET',
                    headers,
                    ...(options.body && { body: JSON.stringify(options.body) })
                };

                try {
                    const response = await fetch(url, config);

                    const contentType = response.headers.get('content-type');
                    if (!contentType || !contentType.includes('application/json')) {
                        const text = await response.text();
                        throw new Error(`Server returned HTML instead of JSON. Status: ${response.status}`);
                    }

                    const data = await response.json();

                    if (!response.ok) {
                        const errorMessage = data.message || data.error || `HTTP ${response.status}: ${response.statusText}`;
                        throw new Error(errorMessage);
                    }

                    return data;
                } catch (error) {
                    console.error(`API Error ${endpoint}:`, error);
                    throw error;
                }
            },

            async getAllThemes() {
                return this.call('/themes');
            },

            async getThemeById(themeId) {
                return this.call(`/themes/${themeId}`);
            },

            async applyThemeToLocation(themeId, locationId) {
                if (!locationId) throw new Error('No location ID provided');
                return this.call('/themes/apply', {
                    method: 'POST',
                    body: { 
                        locationId: locationId,
                        themeId: themeId
                    }
                });
            },

            async getThemeByLocation(locationId) {
                if (!locationId) throw new Error('No location ID provided');
                return this.call(`/themes/by-location/${locationId}`);
            },

            async removeThemeFromLocation(locationId) {
                if (!locationId) throw new Error('No location ID provided');

                try {
                    return await this.call('/themes/remove', {
                        method: 'POST',
                        body: { locationId: locationId }
                    });
                } catch (error) {
                    if (error.message.includes('500')) {
                        return { success: true, message: 'Theme removed locally due to backend error' };
                    }
                    throw error;
                }
            },

            async saveFontSettings(locationId, fontData) {
                return this.call(`/brand-font/${locationId}`, {
                    method: 'POST',
                    body: fontData
                });
            },

            async getFontSettings(locationId) {
                return this.call(`/brand-font/${locationId}`);
            },

            async uploadLogo(formData) {
                const url = `${CONFIG.BACKEND_API}/logo`;

                try {
                    const response = await fetch(url, {
                        method: 'POST',
                        headers: {
                            'x-theme-key': CONFIG.AUTH_TOKEN,
                        },
                        body: formData
                    });

                    const responseText = await response.text();
                    let data;
                    try {
                        data = JSON.parse(responseText);
                    } catch (parseError) {
                        throw new Error('Invalid JSON response from server');
                    }

                    if (data.message && data.message.includes('api_key')) {
                        throw new Error('Backend Cloudinary configuration error: Missing API key');
                    }

                    if (!response.ok) {
                        throw new Error(data.message || data.error || `Upload failed with status ${response.status}`);
                    }

                    if (data && data.logos && data.logos.logo) {
                        return data;
                    }

                    if (data && data.message === "Logos" && data.logos) {
                        return data;
                    }

                    throw new Error(data?.message || data?.error || 'No logo data received');

                } catch (error) {
                    console.error('Upload failed:', error);
                    throw error;
                }
            },


            // ADD THIS NEW FUNCTION inside the uiService object, or rename and use it instead of the complex initLogoUploadFunctionality


            async getLogo(locationId) {
                if (!locationId) throw new Error('No location ID provided');

                try {
                    const response = await this.call(`/logo/${locationId}`);
                    let logoUrl = null;

                    if (response.logos && response.logos.logo) {
                        logoUrl = response.logos.logo;
                    } else if (response.logo) {
                        logoUrl = response.logo;
                    } else if (response.data && response.data.logo) {
                        logoUrl = response.data.logo;
                    }

                    if (logoUrl) {
                        return {
                            success: true,
                            logo: logoUrl,
                            data: response
                        };
                    } else {
                        return {
                            success: false,
                            message: 'No logo found',
                            data: response
                        };
                    }

                } catch (error) {
                    console.error('Get logo failed:', error);

                    if (error.message.includes('404') || error.message.includes('not found')) {
                        return {
                            success: false,
                            message: 'No logo found for this location'
                        };
                    }

                    throw error;
                }
            },

            async saveBrandColors(locationId, colors) {
                try {
                    const response = await this.call(`/brand-color/${locationId}`, {
                        method: 'POST',
                        body: colors
                    });

                    if (response.success || response.data) {
                        return response;
                    } else {
                        throw new Error(response.message || 'Failed to save brand colors');
                    }
                } catch (error) {
                    console.error('API Error saving brand colors:', error);
                    throw error;
                }
            },


            async deleteFontSettings(locationId) {
            if (!locationId) throw new Error('No location ID provided');
            
            return this.call(`/brand-font/${locationId}`, {
                method: 'DELETE'
            });
        },

            async getBrandColors(locationId) {
                return this.call(`/brand-color/${locationId}`);
            }
        };

        const themeCSSService = {
            generateCSS(theme, isPreview = false) {
                if (!theme) return '';

                const variables = {
                    textColor: theme?.textColor || '#ffffff',
                    backgroundColor: theme?.backgroundColor || 'rgba(255, 255, 255, 0.33)',
                    fontFamily: theme?.fontFamily || 'Roboto, sans-serif',
                    sidebarGradientStart: theme?.sidebarGradientStart || null,
                    sidebarGradientEnd: theme?.sidebarGradientEnd || null,
                    headerGradientStart: theme?.headerGradientStart || null,
                    headerGradientEnd: theme?.headerGradientEnd || null
                };

                const isDashboard = window.location.href.includes('/dashboard');
                const isAgency = urlLocationService.isAgencyAccount();
                const comment = isPreview ? 'PREVIEW' : (isAgency ? 'AGENCY' : 'ACTIVE');

                let css = `
        /* GHL Theme Customizer - ${comment} */
        :root {
            --ghl-text-color: ${variables.textColor};
            --ghl-bg-color: ${variables.backgroundColor};
            --ghl-font-family: ${variables.fontFamily};
        `;

                if (variables.sidebarGradientStart && variables.sidebarGradientEnd) {
                    css += `
            --ghl-sidebar-start: ${variables.sidebarGradientStart};
            --ghl-sidebar-end: ${variables.sidebarGradientEnd};`;
                }

                if (variables.headerGradientStart && variables.headerGradientEnd) {
                    css += `
            --ghl-header-start: ${variables.headerGradientStart};
            --ghl-header-end: ${variables.headerGradientEnd};`;
                }

                css += `
        }

        /* Text + fonts */
        .crm-opportunities-status .hl_text,
        .notification-title-message,
        .sidebar-v2-location .hl_force-block,
        .sidebar-v2-location #sidebar-v2 #globalSearchOpener .search-placeholder,
        .sidebar-v2-location #sidebar-v2 #globalSearchOpener .search-icon,
        .sidebar-v2-location #sidebar-v2 #globalSearchOpener .search-shortcut,
        .hl_switcher-loc-name,
        .sidebar-v2-location #sidebar-v2 #location-switcher-sidbar-v2 .hl_switcher-loc-city,
        .sidebar-v2-location #sidebar-v2 .hl_nav-header nav a .nav-title,
        .sidebar-v2-location #sidebar-v2 .hl_nav-header-without-footer nav a .nav-title,
        .sidebar-v2-location #sidebar-v2 .hl_nav-settings nav a .nav-title {
            color: var(--ghl-text-color) !important;
            font-family: var(--ghl-font-family) !important;
        }

        /* Background elements */
        .sidebar-v2-location #sidebar-v2 #location-switcher-sidbar-v2,
        .sidebar-v2-location #sidebar-v2 #globalSearchOpener,
        .sidebar-v2-location #sidebar-v2 #quickActions,
        .sidebar-v2-location #sidebar-v2 #backButtonv2,
        #sb_conversation_ai_settings_v2 .hl_new_badge,
        #sb_knowledge-base-settings .hl_new_badge,
        #sb_objects .hl_new_badge,
        #sb_labs .hl_new_badge,
        #sb_brand-boards .hl_new_badge {
            background-color: var(--ghl-bg-color) !important;
        }
        `;

                if (variables.sidebarGradientStart && variables.sidebarGradientEnd) {
                    css += `
        /* Sidebar gradient - Applied to both agency and sub-accounts */
        .transition-slowest .flex-col > .overflow-hidden,
        .sidebar-v2-location .flex-col > .overflow-hidden,
        [class*="sidebar"] .flex-col > .overflow-hidden,
        .agencyDashboardApp .flex-col > .overflow-hidden {
            background: linear-gradient(135deg, var(--ghl-sidebar-start) 0%, var(--ghl-sidebar-end) 100%) !important;
        }
        `;
                }

                if (variables.headerGradientStart && variables.headerGradientEnd) {
                    css += `
        /* Header gradient - Applied to BOTH agency and sub-accounts */
        /* Sub-account header */
        .sidebar-v2-location .hl_header .container-fluid,
        /* Agency account header */
        .hl_header .container-fluid,
        .agencyDashboardApp .hl_header,
        .agency-dashboard .hl_header,
        [class*="agency"] .hl_header,
        /* General header selectors */
        .header-container,
        .top-header,
        .main-header,
        [class*="header"] .container-fluid {
            background: linear-gradient(135deg, var(--ghl-header-start) 0%, var(--ghl-header-end) 100%) !important;
        }

        /* Additional agency-specific header background */
        .agencyDashboardApp .hl_header,
        [class*="agency"] .hl_header {
            background: linear-gradient(135deg, var(--ghl-header-start) 0%, var(--ghl-header-end) 100%) !important;
        }
        `;
                }

                if (isDashboard) {
                    css += `
        /* Dashboard-specific styles */
        .hl-card .hl-card-header {
            background: linear-gradient(135deg, var(--ghl-header-start) 0%, var(--ghl-header-end) 100%) !important;
            color: #ffffff !important;
        }
        .hl-text-md-medium {
            color: #ffffff !important;
        }
        .hl-wrapper-container {
            background-color: #ffffff !important;
        }
        `;
                }

                return css;
            },
            applyThemeCSS(theme) {
                console.debug('themeCSSService: applyThemeCSS called, url=', window.location.href, 'themeId=', theme && theme._id);
                this.removeThemeCSS();
                if (theme) {
                    const css = this.generateCSS(theme);
                    const style = document.createElement('style');
                    style.id = CONFIG.STYLE_ID;
                    style.textContent = css;
                    document.head.appendChild(style);
                    try { persistentBgService.updateColor(theme.backgroundColor || '#f1f5f9'); } catch (e) { /* ignore */ }
                    return true;
                }
                return false;
            },

            removeThemeCSS() {
                const existingStyle = document.getElementById(CONFIG.STYLE_ID);
                if (existingStyle) {
                    console.debug('themeCSSService: removing theme CSS (', CONFIG.STYLE_ID, ') at', window.location.href);
                    existingStyle.remove();
                } else {
                    console.debug('themeCSSService: removeThemeCSS called but no style found (', CONFIG.STYLE_ID, ')');
                }
            },

            previewThemeCSS(theme) {
                this.removePreviewCSS();
                if (theme) {
                    const css = this.generateCSS(theme, true);
                    const style = document.createElement('style');
                    style.id = CONFIG.PREVIEW_STYLE_ID;
                    style.textContent = css;
                    document.head.appendChild(style);
                    state.isPreviewing = true;
                    state.previewTheme = theme;
                }
            },

            removePreviewCSS() {
                const previewStyle = document.getElementById(CONFIG.PREVIEW_STYLE_ID);
                if (previewStyle) {
                    console.debug('themeCSSService: removing preview CSS (', CONFIG.PREVIEW_STYLE_ID, ')');
                    previewStyle.remove();
                    state.isPreviewing = false;
                    state.previewTheme = null;
                } else {
                    console.debug('themeCSSService: removePreviewCSS called but no preview style found');
                }
            },

            applyCurrentTheme() {
                if (state.currentTheme) {
                    this.applyThemeCSS(state.currentTheme);
                } else {
                    this.removeThemeCSS();
                }
            }
        };

        // =========================
        // Persistent background + DOM observer
        // =========================
        const persistentBgService = {
            STYLE_ID: 'tc-persistent-bg',
            observer: null,

            OVERLAY_ID: 'tc-persistent-overlay',
            headObserver: null,

            ensure(defaultColor = '#f1f5f9') {
                if (!document.getElementById(this.STYLE_ID)) {
                    const s = document.createElement('style');
                    s.id = this.STYLE_ID;
                    s.textContent = `html, body { background-color: ${defaultColor} !important; }`;
                    document.head.appendChild(s);
                    console.debug('persistentBgService: injected persistent background', defaultColor);
                }
                // Ensure overlay exists as additional protection
                try {
                    this.ensureOverlay(defaultColor);
                } catch (e) { /* ignore overlay failures */ }

                // Ensure observers are active so we can re-add if host mutates head/body
                try { this.installDomObserver(); } catch (e) {}
                try { this.installHeadObserver(); } catch (e) {}
            },

            updateColor(color) {
                // Try to use the theme color, but if it's very dark we'll use a light fallback
                const fallback = '#f1f5f9';

                function parseColorToRGB(input) {
                    if (!input) return null;
                    input = input.trim();
                    // hex
                    if (input[0] === '#') {
                        let hex = input.slice(1);
                        if (hex.length === 3) {
                            hex = hex.split('').map(c => c + c).join('');
                        }
                        if (hex.length === 6) {
                            const r = parseInt(hex.slice(0,2),16);
                            const g = parseInt(hex.slice(2,4),16);
                            const b = parseInt(hex.slice(4,6),16);
                            return [r,g,b];
                        }
                        return null;
                    }
                    // rgb/rgba
                    const rgbMatch = input.match(/rgba?\(([^)]+)\)/i);
                    if (rgbMatch) {
                        const parts = rgbMatch[1].split(',').map(p => p.trim());
                        const r = parseInt(parts[0],10);
                        const g = parseInt(parts[1],10);
                        const b = parseInt(parts[2],10);
                        return [r,g,b];
                    }
                    return null;
                }

                function luminance([r,g,b]){
                    const a = [r,g,b].map(v => {
                        v = v/255;
                        return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4);
                    });
                    return 0.2126*a[0] + 0.7152*a[1] + 0.0722*a[2];
                }

                let useColor = fallback;
                const rgb = parseColorToRGB(color);
                if (rgb) {
                    try {
                        const L = luminance(rgb);
                        // If luminance is low (dark), prefer fallback to avoid dark flash
                        if (L >= 0.35) {
                            useColor = color;
                        } else {
                            useColor = fallback;
                        }
                    } catch (e) {
                        useColor = color || fallback;
                    }
                } else {
                    useColor = color || fallback;
                }

                const s = document.getElementById(this.STYLE_ID);
                if (s) {
                    s.textContent = `html, body { background-color: ${useColor} !important; }`;
                    console.debug('persistentBgService: updated bg color to', useColor, '(requested:', color, ')');
                    try { this.updateOverlayColor(useColor); } catch (e) { /* ignore */ }
                } else {
                    this.ensure(useColor);
                }
            },

            // Fullscreen overlay element as a stronger visual fallback
            ensureOverlay(color = '#f1f5f9') {
                try {
                    let o = document.getElementById(this.OVERLAY_ID);
                    if (!o) {
                        o = document.createElement('div');
                        o.id = this.OVERLAY_ID;
                        o.setAttribute('aria-hidden', 'true');
                        o.style.position = 'fixed';
                        o.style.top = '0';
                        o.style.left = '0';
                        o.style.width = '100%';
                        o.style.height = '100%';
                        o.style.zIndex = '999999'; // below panel (panel uses 1000000)
                        o.style.pointerEvents = 'none';
                        o.style.transition = 'none';
                        o.style.opacity = '1';
                        o.style.visibility = 'visible';
                        o.style.background = color;
                        // Attach to documentElement to reduce chance of being removed by body-only wipes
                        try { document.documentElement.appendChild(o); }
                        catch (e) { document.body.appendChild(o); }
                        console.debug('persistentBgService: overlay injected');
                    } else {
                        o.style.background = color;
                        o.style.visibility = 'visible';
                        o.style.opacity = '1';
                    }
                } catch (e) {
                    console.warn('persistentBgService: ensureOverlay failed', e);
                }
            },

            updateOverlayColor(color) {
                try {
                    const o = document.getElementById(this.OVERLAY_ID);
                    if (o) {
                        o.style.background = color;
                    } else {
                        this.ensureOverlay(color);
                    }
                } catch (e) { /* ignore overlay update errors */ }
            },

            removeOverlay() {
                try {
                    const o = document.getElementById(this.OVERLAY_ID);
                    if (o && o.parentNode) o.parentNode.removeChild(o);
                } catch (e) { /* ignore */ }
            },

            installDomObserver() {
                if (this.observer) return;

                const tryInstall = () => {
                    if (!document.body) {
                        setTimeout(tryInstall, 200);
                        return;
                    }

                    this.observer = new MutationObserver((mutations) => {
                        try {
                            for (const m of mutations) {
                                if (m.removedNodes && m.removedNodes.length > 0) {
                                    for (let i = 0; i < m.removedNodes.length; i++) {
                                        const node = m.removedNodes[i];
                                        let desc = null;
                                        try {
                                            if (node && node.nodeType === 1) {
                                                const classes = (node.className || '').toString().trim().replace(/\s+/g, '.');
                                                desc = `${node.nodeName.toLowerCase()}${node.id ? '#'+node.id : ''}${classes ? '.'+classes : ''}`;
                                            } else {
                                                desc = String(node);
                                            }
                                        } catch (e) {
                                            desc = String(node);
                                        }

                                        const stack = (new Error('DOM_REMOVED')).stack;

                                        try {
                                            window.__tc_domRemovalTraces = window.__tc_domRemovalTraces || [];
                                            window.__tc_domRemovalTraces.push({
                                                time: Date.now(),
                                                location: window.location.href,
                                                removedDescriptor: desc,
                                                removedOuterHTML: (node && node.outerHTML && node.outerHTML.length > 1000) ? node.outerHTML.slice(0,1000) + '...' : (node && node.outerHTML) || null,
                                                stack
                                            });
                                            if (window.__tc_domRemovalTraces.length > 100) window.__tc_domRemovalTraces.shift();
                                        } catch (e) { /* swallow storage errors */ }

                                        console.warn('DOM_REMOVED', { removedDescriptor: desc, removedNode: node, stack });
                                    }
                                }
                            }
                        } catch (e) {
                            console.error('persistentBgService: observer callback error', e);
                        }
                    });

                    try {
                        this.observer.observe(document.body, { childList: true, subtree: false });
                        console.debug('persistentBgService: DOM observer installed (instrumentation active)');
                    } catch (err) {
                        console.warn('persistentBgService: failed to install observer', err);
                    }
                };

                tryInstall();
            }
,
            // Observe head to re-insert critical elements if removed by host code
            installHeadObserver() {
                if (this.headObserver) return;
                try {
                    this.headObserver = new MutationObserver((mutations) => {
                        for (const m of mutations) {
                            if (m.removedNodes && m.removedNodes.length > 0) {
                                for (const n of m.removedNodes) {
                                    // If our persistent style or overlay was removed, re-add
                                    if (n && n.id === this.STYLE_ID) {
                                        console.warn('persistentBgService: persistent style was removed, re-adding');
                                        this.ensure();
                                    }
                                }
                            }
                        }
                    });
                    this.headObserver.observe(document.head, { childList: true, subtree: false });
                    console.debug('persistentBgService: head observer installed');
                } catch (e) {
                    console.warn('persistentBgService: failed to install head observer', e);
                }
            }
        };

        // =========================
        // Font Service
        // =========================
        const fontService = {
            async applyFontSettings(fontData) {
                try {
                    if (!state.currentLocation) throw new Error("No location detected");

                    const payload = {
                        fontFamily: fontData.fontFamily,
                        headingSize: parseInt(fontData.headingSize),
                        contentSize: parseInt(fontData.contentSize)
                    };

                    const response = await apiService.saveFontSettings(state.currentLocation.locationId, payload);
                    if (response.success) {
                        // Persist locally after successful backend save
                        try {
                            this.applyFontCSS(payload);
                        } catch (err) {
                            console.warn('Failed to apply font CSS locally after save:', err);
                        }

                        const locationType = state.currentLocation.isAgency ? 'agency account' : 'location';
                        uiService.showNotification(`Font settings applied to ${locationType}!`, 'success');
                    }
                } catch (error) {
                    console.error('Error applying font settings:', error);
                    uiService.showNotification('Failed to apply font settings: ' + error.message, 'error');
                }
            },

    async loadCurrentFont() {
        try {
            if (!state.currentLocation) return null;

            const response = await apiService.getFontSettings(state.currentLocation.locationId);
            
            let fontData = null;
            
            // Try different response structures
            if (response.success && response.data) {
                fontData = response.data;
            } else if (response.font) {
                fontData = response.font;
            } else if (response.data) {
                fontData = response.data;
            } else if (response) {
                fontData = response;
            }

            if (fontData && fontData.fontFamily) {
                const settings = {
                    fontFamily: fontData.fontFamily,
                    headingSize: parseInt(fontData.headingSize) || 18,
                    contentSize: parseInt(fontData.contentSize) || 14
                };
                
                // ✅ CRITICAL: Apply the font CSS immediately
                this.applyFontCSS(settings);
                
                // ✅ IMMEDIATELY update UI controls WITHOUT setTimeout
                this.updateFontControlsImmediately(settings);

                return settings;
            }

            return null;
        } catch (error) {
            const msg = (error && (error.message || String(error))).toLowerCase();
            if (msg.includes('no brand font found') || msg.includes('404')) {
                return null;
            }

            console.error('Error loading font settings:', error);
            return null;
        }
    },

    // Add this helper function
    updateFontControlsImmediately(settings) {
        // Try to update UI immediately
        const fontSelect = document.getElementById('font-family-select');
        const headingSize = document.getElementById('heading-size');
        const contentSize = document.getElementById('content-size');
        const headingDisplay = document.getElementById('heading-size-display');
        const contentDisplay = document.getElementById('content-size-display');

        if (fontSelect && settings.fontFamily) {
            fontSelect.value = settings.fontFamily;
        }
        
        if (headingSize && settings.headingSize) {
            headingSize.value = settings.headingSize;
            if (headingDisplay) {
                headingDisplay.textContent = `${settings.headingSize}px`;
            }
        }
        
        if (contentSize && settings.contentSize) {
            contentSize.value = settings.contentSize;
            if (contentDisplay) {
                contentDisplay.textContent = `${settings.contentSize}px`;
            }
        }
        
        // If UI controls don't exist yet, retry once
        if (!fontSelect || !headingSize || !contentSize) {
            setTimeout(() => this.updateFontControlsImmediately(settings), 100);
        }
    },

            applyFontCSS(settings) {
                const styleId = 'tc-font-style';
                let style = document.getElementById(styleId);
                if (!style) {
                    style = document.createElement('style');
                    style.id = styleId;
                    document.head.appendChild(style);
                }

                style.textContent = `
                        h1, h2, h3, h4, h5, h6 {
                            font-family: '${settings.fontFamily}', sans-serif !important;
                            font-size: ${settings.headingSize}px !important;
                        }
                        p, span, div, a, button, input, textarea, select {
                            font-family: '${settings.fontFamily}', sans-serif !important;
                            font-size: ${settings.contentSize}px !important;
                        }
                    `;
            },

            applyFontPreviewCSS(settings) {
                const styleId = 'tc-font-preview-style';
                let style = document.getElementById(styleId);
                if (!style) {
                    style = document.createElement('style');
                    style.id = styleId;
                    document.head.appendChild(style);
                }

                style.textContent = `
                        h1, h2, h3, h4, h5, h6 {
                            font-family: '${settings.fontFamily}', sans-serif !important;
                            font-size: ${settings.headingSize}px !important;
                        }
                        p, span, div, a, button, input, textarea, select {
                            font-family: '${settings.fontFamily}', sans-serif !important;
                            font-size: ${settings.contentSize}px !important;
                        }
                    `;
            },

            removeFontCSS() {
                const style = document.getElementById('tc-font-style');
                if (style && style.parentNode) {
                    console.debug('fontService: removing font CSS (tc-font-style)');
                    style.parentNode.removeChild(style);
                } else {
                    console.debug('fontService: removeFontCSS called but no style found');
                }
            },

            removePreviewCSS() {
                const style = document.getElementById('tc-font-preview-style');
                if (style && style.parentNode) style.parentNode.removeChild(style);
            },



            async deleteFontSettings(locationId) {
                if (!locationId) throw new Error('No location ID provided');

                return this.call(`/brand-font/${locationId}`, {
                    method: 'DELETE'
                });
            },




            // In fontService, update the resetFont function:
        async resetFont() {
        try {
            if (!state.currentLocation) throw new Error("No location detected");

            const locationId = state.currentLocation.locationId;
            
            console.log('Deleting font for location:', locationId);
            
            try {
                // Try to delete using DELETE endpoint
                await apiService.deleteFontSettings(locationId);
                console.log('Font deleted via DELETE endpoint');
            } catch (deleteError) {
                console.log('DELETE not available, trying alternative:', deleteError.message);
                
                // Alternative: Send empty values
                await apiService.saveFontSettings(locationId, {
                    fontFamily: '',
                    headingSize: 0,
                    contentSize: 0
                });
            }
            
            // Clean up locally (always do this)
            const style = document.getElementById('tc-font-style');
            if (style) style.remove();
            
            const previewStyle = document.getElementById('tc-font-preview-style');
            if (previewStyle) previewStyle.remove();
            
            // Clear localStorage
            try {
                localStorage.removeItem('ghl-theme-customizer-font');
            } catch (e) {}
            
            // Reset UI to defaults
            const fontSelect = document.getElementById('font-family-select');
            const headingSize = document.getElementById('heading-size');
            const contentSize = document.getElementById('content-size');
            
            if (fontSelect) fontSelect.value = 'Roboto';
            if (headingSize) headingSize.value = 18;
            if (contentSize) contentSize.value = 14;
            
            // Update displays
            const headingDisplay = document.getElementById('heading-size-display');
            const contentDisplay = document.getElementById('content-size-display');
            if (headingDisplay) headingDisplay.textContent = '18px';
            if (contentDisplay) contentDisplay.textContent = '14px';

            uiService.showNotification('Font settings removed', 'success');
            
            return {
                fontFamily: 'Roboto',
                headingSize: 18,
                contentSize: 14
            };
            
        } catch (err) {
            console.error('Reset font error:', err);
            uiService.showNotification('Failed to remove font: ' + err.message, 'error');
            return null;
        }
    },



        };

        // =========================
        // Logo Service
        // =========================
        const logoService = {
            // REPLACE ENTIRE logoService.handleLogoUpload FUNCTION:
            async handleLogoUpload() {
                const logoSection = document.getElementById('logo-container');
                const fileInput = logoSection ? logoSection.querySelector('#logo-upload') : document.getElementById('logo-upload');
                const uploadBtn = logoSection ? logoSection.querySelector('#upload-logo-btn') : document.getElementById('upload-logo-btn');

                if (!fileInput || !fileInput.files?.length) {
                    throw new Error('No file selected.');
                }

                const file = fileInput.files[0];

                if (!file.type.startsWith('image/')) {
                    throw new Error('Please select a valid image file (PNG, JPG, JPEG, SVG).');
                }

                if (file.size > 5 * 1024 * 1024) {
                    throw new Error('Image size must be less than 5MB.');
                }

                const formData = new FormData();
                const cleanFileName = this.cleanFileName(file.name);
                const cleanFile = new File([file], cleanFileName, { type: file.type });

                formData.append("logo", cleanFile);

                if (state.currentLocation && state.currentLocation.locationId) {
                    formData.append("locationId", state.currentLocation.locationId);
                } else {
                    // We throw an error so the UI handles the reset
                    throw new Error('Cannot determine current location.');
                }

                try {
                    const result = await apiService.uploadLogo(formData);
                    let logoUrl = result.logos?.logo || result.logo || result.data?.logo;

                    if (!logoUrl) {
                        throw new Error("Logo URL not found in response");
                    }

                    this.applyLogoSettings(logoUrl);
                    this.saveLogoToLocalStorage(logoUrl);

                    // SUCCESS: The UI listener handles the final button visual reset
                    return logoUrl;

                } catch (error) {
                    console.error('Error uploading logo in service:', error);

                    // Fallback logic, but let the UI control the button state on error
                    if (file) {
                        await this.handleLogoUploadFallback(file);
                        uiService.showNotification('Logo applied locally (Backend issue)', 'info');
                    } else {
                        uiService.showNotification('Failed to upload logo. Please try again.', 'error');
                    }
                    throw error; // Re-throw so the UI listener knows the operation failed
                }
            },
            cleanFileName(filename) {
                return filename
                    .trim()
                    .replace(/\s+/g, '_')
                    .replace(/[^a-zA-Z0-9._-]/g, '_');
            },

            saveLogoToLocalStorage(logoUrl) {
                try {
                    const logoData = {
                        url: logoUrl,
                        timestamp: Date.now(),
                        locationId: state.currentLocation?.locationId
                    };
                    localStorage.setItem('ghl-theme-customizer-logo', JSON.stringify(logoData));
                } catch (storageError) {
                    console.warn('Could not save logo to localStorage:', storageError);
                }
            },

            // REPLACE ENTIRE logoService.resetUploadButton FUNCTION:
            resetUploadButton(button) {
                if (button) {
                    // We set the button back to the disabled, inactive state
                    button.disabled = true;
                    button.innerHTML = '<i class="fas fa-upload"></i> Select a file to upload';
                    button.style.background = '#9CA3AF'; // Inactive/Disabled gray color
                    button.style.cursor = 'not-allowed';
                }
            },
            async handleLogoUploadFallback(file) {
                try {
                    const objectUrl = URL.createObjectURL(file);
                    this.applyLogoSettings(objectUrl);

                    const reader = new FileReader();
                    reader.onload = (e) => {
                        try {
                            const logoData = {
                                url: e.target.result,
                                timestamp: Date.now(),
                                locationId: state.currentLocation?.locationId
                            };
                            localStorage.setItem('ghl-theme-customizer-logo', JSON.stringify(logoData));
                        } catch (storageError) {
                            console.warn('Could not save logo to localStorage:', storageError);
                        }
                    };
                    reader.readAsDataURL(file);

                } catch (error) {
                    console.error('Error in logo fallback:', error);
                    throw error;
                }
            },

            async getAndApplyLogo() {
                try {
                    if (!state.currentLocation) {
                        return false;
                    }

                    // First check local storage for cached logo
                    const localLogo = this.loadLocalLogo();
                    if (localLogo) {
                        return true; // Logo found in localStorage
                    }

                    // If no local logo, check backend API
                    const logoResponse = await apiService.getLogo(state.currentLocation.locationId);
                    let logoUrl = null;

                    if (logoResponse && logoResponse.logos && logoResponse.logos.logo) {
                        logoUrl = logoResponse.logos.logo;
                    } else if (logoResponse && logoResponse.logo) {
                        logoUrl = logoResponse.logo;
                    } else if (logoResponse && logoResponse.data && logoResponse.data.logo) {
                        logoUrl = logoResponse.data.logo;
                    }

                    if (logoUrl) {
                        this.applyLogoSettings(logoUrl);
                        return true;
                    } else {
                        // No logo found anywhere - this is normal, don't log errors
                        return false;
                    }

                } catch (error) {
                    // Only log errors that aren't "not found" errors
                    if (!error.message.includes('404') && !error.message.includes('not found')) {
                        console.error('Error getting logo from database:', error);
                    }
                    return false;
                }
            },

            loadLocalLogo() {
                try {
                    const storedLogo = localStorage.getItem('ghl-theme-customizer-logo');
                    if (storedLogo) {
                        const logoData = JSON.parse(storedLogo);

                        // Check if the data is valid
                        if (!logoData || typeof logoData !== 'object') {
                            localStorage.removeItem('ghl-theme-customizer-logo');
                            return false;
                        }

                        // Check if logo belongs to current location or has no location specified
                        if (!logoData.locationId || logoData.locationId === state.currentLocation?.locationId) {
                            // Check if URL is valid
                            if (logoData.url && (logoData.url.startsWith('http') || logoData.url.startsWith('data:image'))) {
                                this.applyLogoSettings(logoData.url);
                                return true;
                            } else {
                                // Invalid URL format, clean up
                                localStorage.removeItem('ghl-theme-customizer-logo');
                            }
                        }
                    }
                    return false;
                } catch (error) {
                    console.warn('Error loading local logo:', error);
                    // Clean up corrupted data
                    localStorage.removeItem('ghl-theme-customizer-logo');
                    return false;
                }
            },


            async checkIfLogoExists() {
                try {
                    if (!state.currentLocation) return false;

                    // Check local storage
                    const storedLogo = localStorage.getItem('ghl-theme-customizer-logo');
                    if (storedLogo) {
                        try {
                            const logoData = JSON.parse(storedLogo);
                            if (logoData && logoData.url &&
                                (!logoData.locationId || logoData.locationId === state.currentLocation.locationId)) {
                                return true;
                            }
                        } catch (e) {
                            // Invalid JSON
                        }
                    }

                    // Check if logo style is currently applied
                    const logoStyle = document.getElementById('tc-logo-style');
                    if (logoStyle && logoStyle.textContent.includes('background-image')) {
                        return true;
                    }

                    return false;
                } catch (error) {
                    return false;
                }
            },


            // right removeLogo
            async removeLogo() {
                try {
                    if (!state.currentLocation) {
                        throw new Error("No location detected");
                    }

                    const locationId = state.currentLocation.locationId;
                    const response = await apiService.removeLogo(locationId);

                    localStorage.removeItem('ghl-theme-customizer-logo');
                    this.removeAppliedLogo();
                    this.resetFileInput();

                    uiService.showNotification('Logo removed successfully!', 'success');
                    return true;

                } catch (error) {
                    console.error('Error removing logo via API:', error);

                    // Even if API fails, remove locally
                    localStorage.removeItem('ghl-theme-customizer-logo');
                    this.removeAppliedLogo();
                    this.resetFileInput();

                    uiService.showNotification('Logo removed locally!', 'info');
                    return true;
                }
            },


            cleanUpLocalLogo() {
                // Remove from localStorage
                localStorage.removeItem('ghl-theme-customizer-logo');

                // Remove applied logo styles
                this.removeAppliedLogo();

                // Reset file input
                this.resetFileInput();

                // Also reset the UI if logo page is open
                const previewContainer = document.getElementById('logo-preview-container');
                const successContainer = document.getElementById('upload-success');
                const progressContainer = document.getElementById('upload-progress');

                if (previewContainer) previewContainer.style.display = 'none';
                if (successContainer) successContainer.style.display = 'none';
                if (progressContainer) progressContainer.style.display = 'none';

                // Reset file input
                const fileInput = document.getElementById('logo-upload');
                if (fileInput) fileInput.value = '';
            },

            resetFileInput() {
                const fileInput = document.getElementById('logo-upload');
                if (fileInput) fileInput.value = '';

                const uploadBtn = document.getElementById('upload-logo-btn');
                if (uploadBtn) {
                    uploadBtn.disabled = true;
                    uploadBtn.style.background = '#9CA3AF';
                    uploadBtn.style.cursor = 'not-allowed';
                    uploadBtn.innerHTML = '<i class="fas fa-upload"></i> Select a file to upload';
                }
            },
            applyLogoSettings(url) {
                const styleId = 'tc-logo-style';
                let style = document.getElementById(styleId);
                const size = 70;

                const css = `
                .agency-logo-container,
                .hl_header--logo,
                [class*="logo"],
                img[src*="logo"],
                img[alt*="logo"] {
                    background-image: url("${url}") !important;
                    background-size: ${size}px auto !important;
                    background-repeat: no-repeat !important;
                    background-position: center !important;
                    background-origin: content-box !important;
                }
                
                .hl_header--logo img,
                .agency-logo-container img,
                [class*="logo"] img {
                    opacity: 0 !important;
                    visibility: hidden !important;
                }
                
                .hl_header--logo,
                .agency-logo-container {
                    width: ${size + 20}px !important;
                    height: ${size + 10}px !important;
                    min-width: ${size + 20}px !important;
                    min-height: ${size + 10}px !important;
                    margin: 0 auto !important;
                    display: flex !important;
                    align-items: center !important;
                    justify-content: center !important;
                }

                div.flex.items-center.justify-center.flex-shrink-0.mb-3,
                div.flex.items-center.justify-center.flex-shrink-0 {
                    width: auto !important;
                    min-width: ${size + 30}px !important;
                    height: ${size + 15}px !important;
                    display: flex !important;
                    align-items: center !important;
                    justify-content: center !important;
                }

                .flex.items-center.justify-center.flex-shrink-0.mb-3 {
                    margin-bottom: 0.5rem !important;
                    padding: 5px 0 !important;
                }
            `;

                if (!style) {
                    style = document.createElement('style');
                    style.id = styleId;
                    document.head.appendChild(style);
                }

                style.textContent = css;
            },

            removeAppliedLogo() {
                const style = document.getElementById('tc-logo-style');
                if (style) {
                    console.debug('logoService: removing applied logo style (tc-logo-style)');
                    style.remove();
                } else {
                    console.debug('logoService: removeAppliedLogo called but no style found');
                }
            }
        };

        // =========================
        // Brand Colors Service
        // =========================
        const brandColorsService = {
            async applyBrandColors(settings) {
                try {
                    if (!state.currentLocation) throw new Error("No location detected");

                    // --- ✅ FIX: Use the globally exposed themeManager or public API reference ---
                    // This ensures the dependency is resolved, avoiding scope/timing errors.
                    const removeThemeFunc = window.GHLThemeCustomizer?.removeTheme || themeManager.removeTheme;

                    // 1. Check if a theme is currently active and remove it.
                    if (state.currentTheme) {
                        // uiService.showNotification('Active theme detected. Removing theme before applying brand colors...', 'info');

                        // Calling the safely retrieved function
                        await removeThemeFunc();
                    }
                    // --- ⚠️ END OF NEW LOGIC ---

                    const colorsToSave = {
                        sidebarColor: settings.sidebar,
                        headerColor: settings.header,
                        backgroundColor: settings.background
                    };

                    if (settings.sidebar === '#ffffff' && settings.header === '#ffffff' && settings.background === '#ffffff') {
                        this.removeColorsCSS();
                        uiService.showNotification('Brand colors reset to default!', 'success');
                        return true;
                    }

                    const response = await apiService.saveBrandColors(state.currentLocation.locationId, colorsToSave);

                    if (response.success || response.data) {
                        this.applyColorsCSS(colorsToSave);
                        const locationType = state.currentLocation.isAgency ? 'agency account' : 'location';
                        uiService.showNotification(`Brand colors applied to ${locationType}!`, 'success');
                        return true;
                    } else {
                        throw new Error('Invalid response from server');
                    }
                } catch (error) {
                    console.error('Error applying brand colors:', error);
                    uiService.showNotification('Failed to apply brand colors: ' + error.message, 'error');
                    return false;
                }
            },

            async resetBrandColors() {
                try {
                    if (!state.currentLocation) throw new Error("No location detected");

                    const defaultColors = {
                        sidebarColor: '#ffffff',
                        headerColor: '#ffffff',
                        backgroundColor: '#ffffff'
                    };

                    const response = await apiService.saveBrandColors(state.currentLocation.locationId, defaultColors);

                    if (response.success || response.data) {
                        this.removeColorsCSS();
                        this.updateColorPickers(defaultColors);
                        const locationType = state.currentLocation.isAgency ? 'agency account' : 'location';
                        uiService.showNotification(`Brand colors reset for ${locationType}!`, 'success');
                        return true;
                    } else {
                        throw new Error('Invalid response from server');
                    }
                } catch (error) {
                    console.error('Error resetting brand colors:', error);
                    uiService.showNotification('Failed to reset brand colors: ' + error.message, 'error');
                    return false;
                }
            },

            applyColorsCSS(settings) {
                const styleId = 'tc-brand-colors-style';
                let style = document.getElementById(styleId);
                if (!style) {
                    style = document.createElement('style');
                    style.id = styleId;
                    document.head.appendChild(style);
                }

                const sidebarColor = settings.sidebarColor || settings.sidebar;
                const headerColor = settings.headerColor || settings.header;
                const backgroundColor = settings.backgroundColor || settings.background;

                let css = '';

                if (sidebarColor && sidebarColor !== '#ffffff') {
                    css += `
                    .pb-2.lead-connector {
                        background-color: ${sidebarColor} !important;
                    }
                    .pb-2 {
                        background-color: ${sidebarColor} !important;
                    }
                    `;
                }

                if (headerColor && headerColor !== '#ffffff') {
                    css += `
                    .container-fluid {
                        background-color: ${headerColor} !important;
                    }
                    `;
                }

                if (backgroundColor && backgroundColor !== '#ffffff') {
                    css += `
                    .launchpad.relative {
                        background-color: ${backgroundColor} !important;
                    }
                    .agencyDashboardApp {
                        background-color: ${backgroundColor} !important;
                    }
                    `;
                }

                style.textContent = css;
            },

            async loadCurrentColors() {
                try {
                    if (!state.currentLocation) return;

                    const response = await apiService.getBrandColors(state.currentLocation.locationId);
                    let colors = null;
                    if (response.success && response.data) {
                        colors = response.data;
                    } else if (response.colors) {
                        colors = response.colors;
                    } else if (response.data) {
                        colors = response.data;
                    }

                    if (colors) {
                        this.applyColorsCSS(colors);
                        this.updateColorPickers(colors);
                    }
                } catch (error) {
                    console.error('Error loading brand colors:', error);
                }
            },

            updateColorPickers(colors) {
                setTimeout(() => {
                    const sidebarColor = document.getElementById('sidebar-color');
                    const headerColor = document.getElementById('header-color');
                    const backgroundColor = document.getElementById('background-color');

                    if (sidebarColor) sidebarColor.value = colors.sidebarColor || colors.sidebar || '#4f46e5';
                    if (headerColor) headerColor.value = colors.headerColor || colors.header || '#7c3aed';
                    if (backgroundColor) backgroundColor.value = colors.backgroundColor || colors.background || '#f1f5f9';
                }, 100);
            },

            removeColorsCSS() {
                const style = document.getElementById('tc-brand-colors-style');
                if (style) {
                    console.debug('brandColorsService: removing colors CSS (tc-brand-colors-style)');
                    style.remove();
                } else {
                    console.debug('brandColorsService: removeColorsCSS called but no style found');
                }
            },
        };
        // =========================
        // Theme Management Service
        // =========================
        const themeManager = {
            async loadThemes() {
                const cachedThemes = cacheService.getThemes();
                if (cachedThemes) {
                    state.themes = cachedThemes;
                    return state.themes;
                }

                try {
                    state.isLoading = true;
                    const response = await apiService.getAllThemes();

                    if (response.success) {
                        let themesArray = [];

                        if (Array.isArray(response.data)) {
                            themesArray = response.data;
                        } else if (Array.isArray(response.themes)) {
                            themesArray = response.themes;
                        } else if (response.data && Array.isArray(response.data.themes)) {
                            themesArray = response.data.themes;
                        } else {
                            themesArray = [response.data || response.theme].filter(Boolean);
                        }

                        state.themes = themesArray;
                        cacheService.setThemes(themesArray);
                        return state.themes;
                    }

                    throw new Error('Invalid themes response from backend');
                } catch (error) {
                    console.error('Failed to load themes from backend:', error);
                    state.themes = [];
                    return [];
                } finally {
                    state.isLoading = false;
                }
            },

            async applyTheme(themeId) {
                try {
                    if (!state.currentLocation) throw new Error('No current location detected');

                    const locationId = state.currentLocation.locationId;
                    const response = await apiService.getThemeById(themeId);
                    let theme = null;

                    if (response.success) {
                        theme = response.data || response.theme;
                    }

                    if (!theme) throw new Error('Theme not found in database');

                    const applyResponse = await apiService.applyThemeToLocation(themeId, locationId);
                    if (applyResponse.success) {
                        state.currentTheme = theme;
                        cacheService.setCurrentTheme(theme);
                        themeCSSService.applyThemeCSS(theme);
                        return true;
                    } else {
                        throw new Error('Backend failed to apply theme to location');
                    }
                } catch (error) {
                    console.error('Failed to apply theme:', error);
                    throw error;
                }
            },

            // async removeTheme() {
            //     try {
            //         if (!state.currentLocation) throw new Error('No current location detected');
            //         if (!state.currentTheme) {
            //             // If no theme is active, just ensure brand colors are applied and exit early.
            //             // This is a safety measure.
            //             await brandColorsService.loadCurrentColors();
            //             return true;
            //         }

            //         const locationId = state.currentLocation.locationId;
            //         const removeResponse = await apiService.removeThemeFromLocation(locationId);

            //         if (removeResponse.success) {
            //             state.currentTheme = null;
            //             cacheService.setCurrentTheme(null);
            //             themeCSSService.removeThemeCSS();

            //             // ✅ CRITICAL ADDITION: Load and apply existing brand colors (or defaults)
            //             // This ensures brand colors saved by the user are instantly visible 
            //             // after the theme's overpowering CSS is removed.
            //             await brandColorsService.loadCurrentColors();

            //             return true;
            //         } else {
            //             throw new Error('Backend failed to remove theme from location');
            //         }
            //     } catch (error) {
            //         console.error('Failed to remove theme:', error);
            //         state.currentTheme = null;
            //         cacheService.setCurrentTheme(null);
            //         themeCSSService.removeThemeCSS();

            //         // Re-apply brand colors even on soft failure to clean up locally applied CSS
            //         await brandColorsService.loadCurrentColors();

            //         throw error;
            //     }
            // },




            async removeTheme(skipReload = false) { // <--- Added parameter
                try {
                    if (!state.currentLocation) throw new Error('No current location detected');
                    if (!state.currentTheme) {
                        // If no theme is active, just ensure brand colors are applied and exit early.
                        if (!skipReload) {
                            await brandColorsService.loadCurrentColors();
                        }
                        return true;
                    }

                    const locationId = state.currentLocation.locationId;
                    const removeResponse = await apiService.removeThemeFromLocation(locationId);

                    if (removeResponse.success) {
                        state.currentTheme = null;
                        cacheService.setCurrentTheme(null);
                        themeCSSService.removeThemeCSS();

                        // ✅ MODIFIED: Only load existing colors if we aren't about to apply new ones
                        if (!skipReload) {
                            await brandColorsService.loadCurrentColors();
                        }

                        return true;
                    } else {
                        throw new Error('Backend failed to remove theme from location');
                    }
                } catch (error) {
                    console.error('Failed to remove theme:', error);
                    state.currentTheme = null;
                    cacheService.setCurrentTheme(null);
                    themeCSSService.removeThemeCSS();

                    // Re-apply brand colors even on soft failure to clean up locally applied CSS
                    if (!skipReload) {
                        await brandColorsService.loadCurrentColors();
                    }

                    throw error;
                }
            },
            async loadCurrentTheme() {
                try {
                    if (!state.currentLocation) {
                        return;
                    }

                    const cachedTheme = cacheService.getCurrentTheme();
                    if (cachedTheme) {
                        state.currentTheme = cachedTheme;
                        themeCSSService.applyThemeCSS(cachedTheme);
                        return;
                    }

                    const locationId = state.currentLocation.locationId;
                    const themeResponse = await apiService.getThemeByLocation(locationId);

                    let theme = null;
                    if (themeResponse.success) {
                        theme = themeResponse.theme || themeResponse.data;
                    }

                    if (theme && theme._id) {
                        state.currentTheme = theme;
                        cacheService.setCurrentTheme(theme);
                        themeCSSService.applyThemeCSS(theme);
                    } else {
                        state.currentTheme = null;
                        cacheService.setCurrentTheme(null);
                        themeCSSService.removeThemeCSS();
                    }
                } catch (error) {
                    const msg = (error && (error.message || String(error))).toLowerCase();
                    if (msg.includes('no active theme found') || msg.includes('404')) {
                        // Backend reports no active theme for this location — treat as empty silently
                        state.currentTheme = null;
                        cacheService.setCurrentTheme(null);
                        themeCSSService.removeThemeCSS();
                        return;
                    }

                    console.error('Failed to load current theme:', error);
                    state.currentTheme = null;
                    cacheService.setCurrentTheme(null);
                    themeCSSService.removeThemeCSS();
                }
            },

            previewTheme: debounce((theme) => {
                themeCSSService.previewThemeCSS(theme);
            }, CONFIG.DEBOUNCE_DELAY),

            cancelPreview() {
                themeCSSService.removePreviewCSS();
                themeCSSService.applyCurrentTheme();
            }
        };

        // =========================
        // UI Service
        // =========================
        const uiService = {
            showNotification(message, type = 'info') {
                const notification = document.createElement('div');
                notification.className = `ghl-notification ${type}`;
                notification.innerHTML = `
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span>${this.getNotificationIcon(type)}</span>
                            <span>${message}</span>
                        </div>
                    `;

                Object.assign(notification.style, {
                    position: 'fixed',
                    top: '20px',
                    right: '20px',
                    background: this.getNotificationColor(type),
                    color: '#ffffff',
                    padding: '12px 20px',
                    borderRadius: '12px',
                    zIndex: 1000001,
                    fontSize: '14px',
                    fontWeight: '500',
                    boxShadow: '0 8px 25px rgba(0,0,0,0.2)',
                    transform: 'translateX(100%)',
                    transition: 'transform 0.3s ease, opacity 0.3s ease',
                    backdropFilter: 'blur(10px)',
                    border: '1px solid rgba(255,255,255,0.1)'
                });

                document.body.appendChild(notification);

                setTimeout(() => notification.style.transform = 'translateX(0)', 10);
                setTimeout(() => {
                    notification.style.transform = 'translateX(100%)';
                    notification.style.opacity = '0';
                    setTimeout(() => {
                        if (notification.parentNode) {
                            notification.remove();
                        }
                    }, 300);
                }, 3000);
            },

            getNotificationIcon(type) {
                const icons = {
                    success: '✅',
                    error: '❌',
                    warning: '⚠️',
                    info: 'ℹ️'
                };
                return icons[type] || icons.info;
            },

            getNotificationColor(type) {
                const colors = {
                    success: 'linear-gradient(135deg, #10B981, #059669)',
                    error: 'linear-gradient(135deg, #DC2626, #B91C1C)',
                    warning: 'linear-gradient(135deg, #F59E0B, #D97706)',
                    info: 'linear-gradient(135deg, #2563EB, #1D4ED8)'
                };
                return colors[type] || colors.info;
            },

    //         ensureScopedCss() {
    //             if (document.getElementById('tc-visibility-style')) return;
    //             const style = document.createElement('style');
    //             style.id = 'tc-visibility-style';
    //             style.textContent = `
    //     /* Apple-style transparent blur design */
    //     .tc-panel {
    //     --glass-bg: rgba(255, 255, 255, 0.85);
    //     --glass-border: rgba(255, 255, 255, 0.2);
    //     --glass-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
    //     --sidebar-bg: rgba(31, 32, 34, 0.9);
    //     --text-primary: #1F2937;
    //     --text-secondary: #6B7280;
    //     --accent-primary: #2563EB;
    //     --accent-hover: #1D4ED8;
    //     font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    //     }
    // #ghl-theme-customizer-btn {
    //     margin: 0 !important;
    //     margin-left:10px !important;

    // }

    //     .tc-panel {
    //     position: fixed;
    //     top: 49px;
    //     right: 40px;
    //     width: 35vw;
    //     max-width: 60vw;
    //     height: 650px;
    //     display : none;
    //     z-index: 1000000;
    //     background: rgba(255, 255, 255, 0.65) !important;
    //     backdrop-filter: blur(25px) saturate(200%);
    //     -webkit-backdrop-filter: blur(25px) saturate(200%);
    //     border: 1px solid rgba(255,255,255,0.15);
    //     border-radius: 16px;
    //     box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.15);
    //     overflow: hidden;
    //     display: grid;
    //     grid-template-columns: 140px 1fr;
    //     overflow: auto;
    //     resize: both;
    //     }

    //     .tc-panel .tc-sidebar { 
    //     background: rgba(31, 32, 34, 0.8) !important;
    //     backdrop-filter: blur(25px) saturate(200%);
    //     -webkit-backdrop-filter: blur(25px) saturate(200%);
    //     display: flex; 
    //     flex-direction: column; 
    //     align-items: center; 
    //     padding: 20px 0; 
    //     gap: 12px; 
    //     overflow-y: auto; 
    //     border-right: 1px solid rgba(255,255,255,0.08);
    //     }

    //     .tc-panel .tc-nav-btn { 
    //     display: flex; 
    //     flex-direction: column; 
    //     align-items: center; 
    //     gap: 6px; 
    //     width: 70%; 
    //     padding: 12px 0; 
    //     border-radius: 12px; 
    //     border: 1px solid rgba(255,255,255,0.15);
    //     background: rgba(255,255,255,0.1);
    //     color: #E5E7EB; 
    //     cursor: pointer; 
    //     transition: all 0.2s ease;
    //     font-size: 11px;
    //     backdrop-filter: blur(10px);
    //     }

    //     .tc-panel .tc-nav-btn:hover { 
    //     background: rgba(255,255,255,0.15); 
    //     transform: translateY(-1px);
    //     border-color: rgba(255,255,255,0.2);
    //     }

    //     .tc-panel .tc-nav-btn.active { 
    //     background: linear-gradient(135deg, #2563EB, #1D4ED8);
    //     color: #fff; 
    //     border-color: rgba(255,255,255,0.3);
    //     box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);
    //     }

    //     .tc-panel .tc-nav-btn i {
    //     font-size: 16px;
    //     margin-bottom: 4px;
    //     }

    //     .tc-panel .tc-content { 
    //     position: relative; 
    //     padding: 24px 20px 20px 20px; 
    //     overflow-y: auto; 
    //     background: transparent;
    //     }

    //     .tc-panel .tc-user-info { 
    //     margin-bottom: 16px; 
    //     font-size: 16px; 
    //     font-weight: 600; 
    //     color: var(--text-primary);
    //     display: flex; 
    //     justify-content: space-between; 
    //     align-items: center; 
    //     }

    //     .tc-panel .tc-close { 
    //     background: rgba(0,0,0,0.1); 
    //     border: 1px solid rgba(0,0,0,0.1);
    //     color: var(--text-secondary); 
    //     font-size: 20px; 
    //     cursor: pointer; 
    //     padding: 6px 10px; 
    //     line-height: 1; 
    //     border-radius: 8px;
    //     transition: all 0.2s ease;
    //     backdrop-filter: blur(10px);
    //     }

    //     .tc-panel .tc-close:hover { 
    //     background: rgba(0,0,0,0.15);
    //     color: var(--text-primary); 
    //     }

    //     .tc-panel .tc-section { 
    //     background: rgba(255, 255, 255, 0.5) !important;
    //     backdrop-filter: blur(15px);
    //     -webkit-backdrop-filter: blur(15px);
    //     border: 1px solid rgba(255,255,255,0.2);
    //     border-radius: 12px; 
    //     box-shadow: 0 4px 12px rgba(0,0,0,0.03);
    //     padding: 20px; 
    //     width: 100%; 
    //     margin-bottom: 16px;
    //     }

    //     .tc-panel .tc-section h2 { 
    //     margin: 0 0 8px 0; 
    //     font-size: 18px; 
    //     font-weight: 700;
    //     color: var(--text-primary);
    //     }

    //     .tc-panel #${CONFIG.TOOLBAR_ID} { 
    //     margin-bottom: 16px; 
    //     }

    //     .tc-panel .btn { 
    //     appearance: none; 
    //     border: 1px solid rgba(255,255,255,0.2);
    //     border-radius: 10px; 
    //     background: linear-gradient(135deg, var(--accent-primary), var(--accent-hover));
    //     color: #fff; 
    //     padding: 10px 16px; 
    //     font-size: 14px; 
    //     cursor: pointer; 
    //     font-weight: 600;
    //     transition: all 0.2s ease;
    //     backdrop-filter: blur(10px);
    //     }

    //     .tc-panel .btn:hover { 
    //     transform: translateY(-1px);
    //     box-shadow: 0 6px 20px rgba(37, 99, 235, 0.3);
    //     }

    //     .tc-panel .btn-reset { 
    //     background: linear-gradient(135deg, #FEE2E2, #FECACA) !important; 
    //     color: #B91C1C !important; 
    //     border: 1px solid rgba(254, 226, 226, 0.3) !important;
    //     }

    //     .tc-panel .btn-reset:hover {
    //     background: linear-gradient(135deg, #FECACA, #FCA5A5) !important;
    //     }

    //     .tc-panel .btn-secondary { 
    //     background: rgba(255, 255, 255, 0.6) !important; 
    //     border: 1px solid rgba(229, 231, 235, 0.6) !important; 
    //     padding: 8px 12px; 
    //     border-radius: 8px; 
    //     cursor: pointer; 
    //     color: var(--text-primary) !important;
    //     font-weight: 500;
    //     backdrop-filter: blur(10px);
    //     }

    //     .tc-panel .btn-secondary:hover {
    //     background: rgba(255, 255, 255, 0.8) !important;
    //     border-color: rgba(209, 213, 219, 0.8) !important;
    //     }

    //     .tc-panel label { 
    //     display: block; 
    //     font-size: 14px; 
    //     margin-bottom: 6px; 
    //     font-weight: 600; 
    //     color: var(--text-primary);
    //     }

    //     .tc-panel select,
    //     .tc-panel input[type="text"],
    //     .tc-panel input[type="email"],
    //     .tc-panel input[type="number"],
    //     .tc-panel input[type="file"] {
    //     width: 100%; 
    //     padding: 12px; 
    //     border-radius: 8px; 
    //     border: 1px solid rgba(229, 231, 235, 0.6);
    //     background: rgba(255, 255, 255, 0.7);
    //     font-size: 14px; 
    //     transition: all 0.2s ease;
    //     backdrop-filter: blur(10px);
    //     }

    //     .tc-panel select:focus,
    //     .tc-panel input:focus {
    //     outline: none;
    //     border-color: var(--accent-primary);
    //     box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
    //     background: rgba(255, 255, 255, 0.9);
    //     }

    //     .tc-panel input[type="color"] {
    //     width: 100%;
    //     height: 44px;
    //     border: 1px solid rgba(229, 231, 235, 0.6);
    //     border-radius: 8px;
    //     cursor: pointer;
    //     background: rgba(255, 255, 255, 0.7);
    //     backdrop-filter: blur(10px);
    //     }

    //     .theme-item {
    //     display: flex;
    //     align-items: center;
    //     justify-content: space-between;
    //     width: 100%;
    //     margin: 8px 0;
    //     padding: 16px;
    //     border-radius: 12px;
    //     border: 1px solid rgba(229, 231, 235, 0.6);
    //     background: rgba(255, 255, 255, 0.6);
    //     cursor: pointer;
    //     transition: all 0.2s ease;
    //     backdrop-filter: blur(10px);
    //     }

    //     .theme-item:hover {
    //     border-color: var(--accent-primary);
    //     transform: translateY(-2px);
    //     box-shadow: 0 8px 20px rgba(0,0,0,0.1);
    //     background: rgba(255, 255, 255, 0.8);
    //     }

    //     .theme-item.active {
    //     border: 2px solid #10B981;
    //     background: rgba(240, 253, 244, 0.8);
    //     }

    //     #${CONFIG.BTN_ID} { 
    //     background: rgba(255, 255, 255, 0.9);
    //     border: 1px solid rgba(229, 231, 235, 0.8);
    //     padding: 8px;
    //     font-size: 18px;
    //     color: #2563EB;
    //     cursor: pointer;
    //     display: inline-flex;
    //     align-items: center;
    //     line-height: 1;
    //     border-radius: 10px;
    //     transition: all 0.2s ease;
    //     backdrop-filter: blur(10px);
    //     box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    //     }

    //     #${CONFIG.BTN_ID}:hover {
    //     transform: translateY(-1px);
    //     box-shadow: 0 6px 20px rgba(0,0,0,0.15);
    //     background: rgba(255, 255, 255, 1);
    //     }




    //     .upload-container {
    //   display: flex;
    //   flex-direction: column;
    //   align-items: center;
    //   gap: 16px;
    //   padding: 24px;
    //   border: 2px dashed #ddd;
    //   border-radius: 12px;
    //   background: #fafafa;
    //   transition: all 0.3s ease;
    //   margin: 20px 0;
    // }

    // .upload-container:hover {
    //   border-color: #4a90e2;
    //   background: #f0f7ff;
    // }

    // .file-info {
    //   display: flex;
    //   align-items: center;
    //   gap: 12px;
    //   padding: 12px 16px;
    //   background: white;
    //   border-radius: 8px;
    //   border: 1px solid #eee;
    //   width: 100%;
    //   max-width: 500px;
    // }

    // .file-icon {
    //   font-size: 24px;
    //   color: #4a90e2;
    // }

    // .file-details {
    //   flex: 1;
    // }

    // .file-name {
    //   font-weight: 600;
    //   color: #333;
    //   margin-bottom: 4px;
    // }

    // .file-size {
    //   font-size: 14px;
    //   color: #666;
    // }

    // .button-group {
    //   display: flex;
    //   gap: 12px;
    //   flex-wrap: wrap;
    //   justify-content: center;
    // }

    // .upload-btn, .apply-btn, .cancel-btn {
    //   padding: 12px 24px;
    //   border: none;
    //   border-radius: 8px;
    //   font-weight: 600;
    //   cursor: pointer;
    //   transition: all 0.2s ease;
    //   font-size: 15px;
    //   min-width: 120px;
    //   display: flex;
    //   align-items: center;
    //   justify-content: center;
    //   gap: 8px;
    // }

    // .upload-btn {
    //   background: #4a90e2;
    //   color: white;
    // }

    // .upload-btn:hover {
    //   background: #3a80d2;
    //   transform: translateY(-1px);
    // }

    // .upload-btn:active {
    //   transform: translateY(0);
    // }

    // .apply-btn {
    //   background: #34c759;
    //   color: white;
    // }

    // .apply-btn:hover {
    //   background: #2cb750;
    //   transform: translateY(-1px);
    // }

    // .cancel-btn {
    //   background: #ff3b30;
    //   color: white;
    // }

    // .cancel-btn:hover {
    //   background: #e02a20;
    //   transform: translateY(-1px);
    // }

    // /* Responsive adjustments */
    // @media (max-width: 600px) {
    //   .button-group {
    //     flex-direction: column;
    //     width: 100%;
    //   }
    
    //   .upload-btn, .apply-btn, .cancel-btn {
    //     width: 100%;
    //   }
    
    //   .upload-container {
    //     padding: 16px;
    //   }
    // }

    //     @media screen and (max-width: 1024px) { 
    //     .tc-panel { 
    //         width: 50vw; 
    //     } 
    //     }

    //     @media screen and (max-width: 768px) { 
    //     .tc-panel { 
    //         width: 90vw; 
    //         height: 80vh;
    //         grid-template-columns: 100px 1fr;
    //         top: 20px;
    //         right: 20px;
    //         left: 20px;
    //         bottom: 20px;
    //     } 
    //     }

    //     @media screen and (max-width: 480px) { 
    //     .tc-panel { 
    //         grid-template-columns: 80px 1fr;
    //     } 
    //     .tc-panel .tc-nav-btn span { 
    //         display: none; 
    //     }
    //     .tc-panel .tc-nav-btn i {
    //         font-size: 18px;
    //     }
    //     }

    //     #tc-notification-container {
    //     position: fixed;
    //     top: 20px;
    //     right: 20px;
    //     z-index: 1000001 !important;
    //     pointer-events: none;
    //     display: flex;
    //     flex-direction: column;
    //     gap: 10px;
    //     max-width: 400px;
    //     }

    //     `;
    //             document.head.appendChild(style);
    //         },


    ensureScopedCss() {
        if (document.getElementById('tc-visibility-style')) return;
        const style = document.createElement('style');
        style.id = 'tc-visibility-style';
        style.textContent = `
        /* Apple-style transparent blur design */
        .tc-panel {
        --glass-bg: rgba(255, 255, 255, 0.85);
        --glass-border: rgba(255, 255, 255, 0.2);
        --glass-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
        --sidebar-bg: rgba(31, 32, 34, 0.9);
        --text-primary: #1F2937;
        --text-secondary: #6B7280;
        --accent-primary: #2563EB;
        --accent-hover: #1D4ED8;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        
        /* ✅ CRITICAL FIX: Ensure proper box-sizing */
        box-sizing: border-box !important;
        }

        /* ✅ CRITICAL FIX: Ensure all child elements inherit box-sizing */
        .tc-panel *,
        .tc-panel *::before,
        .tc-panel *::after {
            box-sizing: inherit !important;
        }

        /* ✅ CRITICAL FIX: Allow inline styles to override */
        .tc-panel {
            display: none; /* Default to hidden */
        }

    #ghl-theme-customizer-btn {
        margin: 0 !important;
        margin-left:10px !important;

    }

        .tc-panel {
        position: fixed;
        top: 49px;
        right: 40px;
        width: 35vw;
        max-width: 60vw;
        height: 650px;
        z-index: 1000000;
        background: rgba(255, 255, 255, 0.65) !important;
        backdrop-filter: blur(25px) saturate(200%);
        -webkit-backdrop-filter: blur(25px) saturate(200%);
        border: 1px solid rgba(255,255,255,0.15);
        border-radius: 16px;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.15);
        overflow: hidden;
        display: none !important; /* ✅ FIX: Panel hidden by default, toggle with inline display style */
        grid-template-columns: 140px 1fr;
        overflow: auto;
        resize: both;
        
        /* ✅ CRITICAL FIX: Ensure panel has proper layout */
        min-width: 400px !important;
        min-height: 500px !important;
        }

        .tc-panel .tc-sidebar { 
        background: rgba(31, 32, 34, 0.8) !important;
        backdrop-filter: blur(25px) saturate(200%);
        -webkit-backdrop-filter: blur(25px) saturate(200%);
        display: flex; 
        flex-direction: column; 
        align-items: center; 
        padding: 20px 0; 
        gap: 12px; 
        overflow-y: auto; 
        border-right: 1px solid rgba(255,255,255,0.08);
        
        /* ✅ CRITICAL FIX: Prevent sidebar overflow */
        flex-shrink: 0 !important;
        }

        .tc-panel .tc-nav-btn { 
        display: flex; 
        flex-direction: column; 
        align-items: center; 
        gap: 6px; 
        width: 70%; 
        padding: 12px 0; 
        border-radius: 12px; 
        border: 1px solid rgba(255,255,255,0.15);
        background: rgba(255,255,255,0.1);
        color: #E5E7EB; 
        cursor: pointer; 
        transition: all 0.2s ease;
        font-size: 11px;
        backdrop-filter: blur(10px);
        
        /* ✅ CRITICAL FIX: Prevent button overflow */
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        white-space: nowrap !important;
        }

        .tc-panel .tc-nav-btn:hover { 
        background: rgba(255,255,255,0.15); 
        transform: translateY(-1px);
        border-color: rgba(255,255,255,0.2);
        }

        .tc-panel .tc-nav-btn.active { 
        background: linear-gradient(135deg, #2563EB, #1D4ED8);
        color: #fff; 
        border-color: rgba(255,255,255,0.3);
        box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);
        }

        .tc-panel .tc-nav-btn i {
        font-size: 16px;
        margin-bottom: 4px;
        }

        .tc-panel .tc-content { 
        position: relative; 
        padding: 24px 20px 20px 20px; 
        overflow-y: auto; 
        background: transparent;
        
        /* ✅ CRITICAL FIX: Ensure content area scrolls properly */
        overflow-x: hidden !important;
        }

        /* Prevent visual flash when inline styles toggle display */
        .tc-panel[style*="display: none"] {
            visibility: hidden !important;
            opacity: 0 !important;
            transition: none !important;
            pointer-events: none !important;
        }

        .tc-panel[style*="display: grid"] {
            visibility: visible !important;
            opacity: 1 !important;
            transition: none !important;
            pointer-events: auto !important;
        }

        .tc-panel .tc-user-info { 
        margin-bottom: 16px; 
        font-size: 16px; 
        font-weight: 600; 
        color: var(--text-primary);
        display: flex; 
        justify-content: space-between; 
        align-items: center; 
        }

        .tc-panel .tc-close { 
        background: rgba(0,0,0,0.1); 
        border: 1px solid rgba(0,0,0,0.1);
        color: var(--text-secondary); 
        font-size: 20px; 
        cursor: pointer; 
        padding: 6px 10px; 
        line-height: 1; 
        border-radius: 8px;
        transition: all 0.2s ease;
        backdrop-filter: blur(10px);
        }

        .tc-panel .tc-close:hover { 
        background: rgba(0,0,0,0.15);
        color: var(--text-primary); 
        }

        .tc-panel .tc-section { 
        background: rgba(255, 255, 255, 0.5) !important;
        backdrop-filter: blur(15px);
        -webkit-backdrop-filter: blur(15px);
        border: 1px solid rgba(255,255,255,0.2);
        border-radius: 12px; 
        box-shadow: 0 4px 12px rgba(0,0,0,0.03);
        padding: 20px; 
        width: 100%; 
        margin-bottom: 16px;
        
        /* ✅ CRITICAL FIX: Prevent section overflow */
        max-width: 100% !important;
        }

        .tc-panel .tc-section h2 { 
        margin: 0 0 8px 0; 
        font-size: 18px; 
        font-weight: 700;
        color: var(--text-primary);
        }

        .tc-panel #${CONFIG.TOOLBAR_ID} { 
        margin-bottom: 16px; 
        }

        .tc-panel .btn { 
        appearance: none; 
        border: 1px solid rgba(255,255,255,0.2);
        border-radius: 10px; 
        background: linear-gradient(135deg, var(--accent-primary), var(--accent-hover));
        color: #fff; 
        padding: 10px 16px; 
        font-size: 14px; 
        cursor: pointer; 
        font-weight: 600;
        transition: all 0.2s ease;
        backdrop-filter: blur(10px);
        
        /* ✅ CRITICAL FIX: Prevent button text overflow */
        white-space: nowrap !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        }

        .tc-panel .btn:hover { 
        transform: translateY(-1px);
        box-shadow: 0 6px 20px rgba(37, 99, 235, 0.3);
        }

        .tc-panel .btn-reset { 
        background: linear-gradient(135deg, #FEE2E2, #FECACA) !important; 
        color: #B91C1C !important; 
        border: 1px solid rgba(254, 226, 226, 0.3) !important;
        }

        .tc-panel .btn-reset:hover {
        background: linear-gradient(135deg, #FECACA, #FCA5A5) !important;
        }

        .tc-panel .btn-secondary { 
        background: rgba(255, 255, 255, 0.6) !important; 
        border: 1px solid rgba(229, 231, 235, 0.6) !important; 
        padding: 8px 12px; 
        border-radius: 8px; 
        cursor: pointer; 
        color: var(--text-primary) !important;
        font-weight: 500;
        backdrop-filter: blur(10px);
        }

        .tc-panel .btn-secondary:hover {
        background: rgba(255, 255, 255, 0.8) !important;
        border-color: rgba(209, 213, 219, 0.8) !important;
        }

        .tc-panel label { 
        display: block; 
        font-size: 14px; 
        margin-bottom: 6px; 
        font-weight: 600; 
        color: var(--text-primary);
        }

        .tc-panel select,
        .tc-panel input[type="text"],
        .tc-panel input[type="email"],
        .tc-panel input[type="number"],
        .tc-panel input[type="file"] {
        width: 100%; 
        padding: 12px; 
        border-radius: 8px; 
        border: 1px solid rgba(229, 231, 235, 0.6);
        background: rgba(255, 255, 255, 0.7);
        font-size: 14px; 
        transition: all 0.2s ease;
        backdrop-filter: blur(10px);
        
        /* ✅ CRITICAL FIX: Prevent input overflow */
        max-width: 100% !important;
        }

        .tc-panel select:focus,
        .tc-panel input:focus {
        outline: none;
        border-color: var(--accent-primary);
        box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
        background: rgba(255, 255, 255, 0.9);
        }

        .tc-panel input[type="color"] {
        width: 100%;
        height: 44px;
        border: 1px solid rgba(229, 231, 235, 0.6);
        border-radius: 8px;
        cursor: pointer;
        background: rgba(255, 255, 255, 0.7);
        backdrop-filter: blur(10px);
        }

        .theme-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        width: 100%;
        margin: 8px 0;
        padding: 16px;
        border-radius: 12px;
        border: 1px solid rgba(229, 231, 235, 0.6);
        background: rgba(255, 255, 255, 0.6);
        cursor: pointer;
        transition: all 0.2s ease;
        backdrop-filter: blur(10px);
        
        /* ✅ CRITICAL FIX: Prevent theme item overflow */
        overflow: hidden !important;
        }

        .theme-item:hover {
        border-color: var(--accent-primary);
        transform: translateY(-2px);
        box-shadow: 0 8px 20px rgba(0,0,0,0.1);
        background: rgba(255, 255, 255, 0.8);
        }

        .theme-item.active {
        border: 2px solid #10B981;
        background: rgba(240, 253, 244, 0.8);
        }

        #${CONFIG.BTN_ID} { 
        background: rgba(255, 255, 255, 0.9);
        border: 1px solid rgba(229, 231, 235, 0.8);
        padding: 8px;
        font-size: 18px;
        color: #2563EB;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        line-height: 1;
        border-radius: 10px;
        transition: all 0.2s ease;
        backdrop-filter: blur(10px);
        box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        }

        #${CONFIG.BTN_ID}:hover {
        transform: translateY(-1px);
        box-shadow: 0 6px 20px rgba(0,0,0,0.15);
        background: rgba(255, 255, 255, 1);
        }




        .upload-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    padding: 24px;
    border: 2px dashed #ddd;
    border-radius: 12px;
    background: #fafafa;
    transition: all 0.3s ease;
    margin: 20px 0;
    }

    .upload-container:hover {
    border-color: #4a90e2;
    background: #f0f7ff;
    }

    .file-info {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    background: white;
    border-radius: 8px;
    border: 1px solid #eee;
    width: 100%;
    max-width: 500px;
    }

    .file-icon {
    font-size: 24px;
    color: #4a90e2;
    }

    .file-details {
    flex: 1;
    }

    .file-name {
    font-weight: 600;
    color: #333;
    margin-bottom: 4px;
    }

    .file-size {
    font-size: 14px;
    color: #666;
    }

    .button-group {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    justify-content: center;
    }

    .upload-btn, .apply-btn, .cancel-btn {
    padding: 12px 24px;
    border: none;
    border-radius: 8px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    font-size: 15px;
    min-width: 120px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    }

    .upload-btn {
    background: #4a90e2;
    color: white;
    }

    .upload-btn:hover {
    background: #3a80d2;
    transform: translateY(-1px);
    }

    .upload-btn:active {
    transform: translateY(0);
    }

    .apply-btn {
    background: #34c759;
    color: white;
    }

    .apply-btn:hover {
    background: #2cb750;
    transform: translateY(-1px);
    }

    .cancel-btn {
    background: #ff3b30;
    color: white;
    }

    .cancel-btn:hover {
    background: #e02a20;
    transform: translateY(-1px);
    }

    /* Responsive adjustments */
    @media (max-width: 600px) {
    .button-group {
        flex-direction: column;
        width: 100%;
    }
    
    .upload-btn, .apply-btn, .cancel-btn {
        width: 100%;
    }
    
    .upload-container {
        padding: 16px;
    }
    }

        @media screen and (max-width: 1024px) { 
        .tc-panel { 
            width: 50vw; 
        } 
        }

        @media screen and (max-width: 768px) { 
        .tc-panel { 
            width: 90vw; 
            height: 80vh;
            grid-template-columns: 100px 1fr;
            top: 20px;
            right: 20px;
            left: 20px;
            bottom: 20px;
        } 
        }

        @media screen and (max-width: 480px) { 
        .tc-panel { 
            grid-template-columns: 80px 1fr;
        } 
        .tc-panel .tc-nav-btn span { 
            display: none; 
        }
        .tc-panel .tc-nav-btn i {
            font-size: 18px;
        }
        }

        #tc-notification-container {
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 1000001 !important;
        pointer-events: none;
        display: flex;
        flex-direction: column;
        gap: 10px;
        max-width: 400px;
        }

        `;
        document.head.appendChild(style);
    },



    ensureFA() {
                if (document.getElementById('tc-fa')) return;
                const link = document.createElement('link');
                link.id = 'tc-fa';
                link.rel = 'stylesheet';
                link.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css';
                link.crossOrigin = 'anonymous';
                link.referrerPolicy = 'no-referrer';
                document.head.appendChild(link);
            },

            injectPanelIfMissing() {
                if (document.getElementById(CONFIG.PANEL_ID)) return true;
                // Ensure Font Awesome stylesheet is present by injecting a <link> into head
                if (!document.getElementById('tc-fa')) {
                    const link = document.createElement('link');
                    link.id = 'tc-fa';
                    link.rel = 'stylesheet';
                    link.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css';
                    link.crossOrigin = 'anonymous';
                    link.referrerPolicy = 'no-referrer';
                    document.head.appendChild(link);
                }
                const panel = document.createElement('aside');
                panel.id = CONFIG.PANEL_ID;
                panel.className = 'tc-panel';
                panel.style.setProperty('display', 'none', 'important'); // ✅ Hide panel by default with !important
                panel.innerHTML = `
                        <nav class="tc-sidebar" aria-label="Theme Customizer Navigation">
                            <button class="tc-nav-btn" data-page="themes"><i class="fas fa-th"></i><span>Themes</span></button>
                            <button class="tc-nav-btn" data-page="logo"><i class="fas fa-flag"></i><span>Logo</span></button>
                            <button class="tc-nav-btn" data-page="font"><i class="fa-solid fa-font"></i><span>Brand Font</span></button>
                            <button class="tc-nav-btn" data-page="colors"><i class="fa-solid fa-palette"></i><span>Brand Colors</span></button>
                            <button class="tc-nav-btn" data-page="support"><i class="fa-solid fa-headset"></i><span>Support</span></button>
                        </nav>
                        <section class="tc-content">
                            <div class="tc-user-info">
                                <span class="tc-user-name">Welcome, Theme Customizer</span>
                                <button class="tc-close" type="button" aria-label="Close">&times;</button>
                            </div>
                            <div id="${CONFIG.TOOLBAR_ID}"></div>
                            <div class="tc-section" id="${CONFIG.CONTENT_ID}"></div>
                        </section>
                    `;
                document.body.appendChild(panel);
                panel.querySelector('.tc-close')?.addEventListener('click', () => {
                    this.closePanel();
                });
                return true;
            },

            proactiveCleanup() {
                // Aggressively remove known injected style elements to avoid visual flicker
                // const ids = [
                //     'tc-theme-style',
                //     'tc-theme-preview',
                //     'tc-font-style',
                //     'tc-font-preview-style',
                //     'tc-brand-colors-style',
                //     'tc-logo-style'
                // ];

                // ids.forEach(id => {
                //     try {
                //         const el = document.getElementById(id);
                //         if (el && el.parentNode) el.parentNode.removeChild(el);
                //     } catch (err) {
                //         // ignore removal errors
                //     }
                // });


                return;
            },


            makeBtn() {
                const existing = document.getElementById(CONFIG.BTN_ID);
                if (existing) return existing;

                const btn = document.createElement('button');
                btn.id = CONFIG.BTN_ID;
                btn.setAttribute('title', 'Customize Theme');
                btn.innerHTML = '<i class="fa-solid fa-palette"></i>';
                btn.addEventListener('click', () => this.togglePanel());

                // ✅ ADD THESE STYLES
                Object.assign(btn.style, {
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '40px',
                    height: '40px',
                    // margin: '0', 
                    marginLeft: '4px',
                    padding: '8px',
                    borderRadius: '8px',
                    background: 'rgba(255, 255, 255, 0.9)',
                    border: '1px solid rgba(229, 231, 235, 0.8)',
                    fontSize: '18px',
                    color: '#2563EB',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    backdropFilter: 'blur(10px)',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                    flexShrink: '0',
                    outline: 'none'
                });

                // ✅ ADD HOVER EFFECTS
                btn.addEventListener('mouseenter', () => {
                    btn.style.background = 'rgba(255, 255, 255, 1)';
                    btn.style.borderColor = 'rgba(209, 213, 219, 0.8)';
                    btn.style.transform = 'translateY(-1px)';
                    btn.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
                });

                btn.addEventListener('mouseleave', () => {
                    btn.style.background = 'rgba(255, 255, 255, 0.9)';
                    btn.style.borderColor = 'rgba(229, 231, 235, 0.8)';
                    btn.style.transform = 'translateY(0)';
                    btn.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
                });

                btn.addEventListener('mousedown', () => {
                    btn.style.transform = 'translateY(0)';
                    btn.style.boxShadow = '0 1px 4px rgba(0,0,0,0.1)';
                });

                btn.addEventListener('mouseup', () => {
                    btn.style.transform = 'translateY(-1px)';
                    btn.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
                });

                return btn;
            },
    

        mountBeforeHeaderIcons() {
        // 1. Access Check
        if (!state.hasThemeBuilderAccess) {
            this.removeCustomizerUI();
            return false;
        }

        // 2. Page Builder Check (Don't show in builder)
        if (location.pathname.includes("/page-builder/")) {
            return false; 
        }

        // 3. Retry Limit Check
        if (document.getElementById(CONFIG.BTN_ID)) {
            state.mountRetryCount = 0;
            return true; // Already mounted
        }

        if (state.mountRetryCount >= state.MAX_MOUNT_RETRIES) {
            // console.warn('Max mount retries reached');
            return false;
        }

        state.mountRetryCount++;

        // 4. FIND THE CONTAINER (The Fix)
        // We try all these selectors. The first one found wins.
        const possibleContainers = [
            '.hl_header--controls',       // Common in Agency
            '.hl_header--right',          // Common in Sub-accounts
            '.hl_header .flex.items-center.justify-end', // New UI V2
            '.hl_header > div:last-child', // Fallback generic
            '.nav-header-controls',       // Older UI
            '[class*="header"] [class*="right"]' // Fuzzy match
        ];

        let targetContainer = null;
        
        for (const selector of possibleContainers) {
            const el = document.querySelector(selector);
            if (el) {
                targetContainer = el;
                // console.log('Found header container:', selector);
                break; // Stop looking, we found it
            }
        }

        // If we still can't find a container, wait and try again next heartbeat
        if (!targetContainer) return false;

        // 5. Create and Insert Button
        const btn = this.makeBtn();
        
        // Remove duplicates if any exist
        const existingBtn = document.getElementById(CONFIG.BTN_ID);
        if (existingBtn) existingBtn.remove();

        // Insert BEFORE the Copilot icon if it exists, otherwise at the start
        const copilotIcon = document.querySelector('#hl_header--copilot-icon');
        
        if (copilotIcon && targetContainer.contains(copilotIcon)) {
            targetContainer.insertBefore(btn, copilotIcon);
        } else {
            targetContainer.prepend(btn);
        }

        // Visual spacing
        btn.style.margin = '0 8px'; 
        
        return true;
    },

            removeCustomizerUI() {
                const btn = document.getElementById(CONFIG.BTN_ID);
                if (btn) btn.remove();

                const panel = document.getElementById(CONFIG.PANEL_ID);
                if (panel) panel.remove();
            },

            // togglePanel() {
            //     if (!state.hasThemeBuilderAccess) {
            //         return;
            //     }

            //     let panel = document.getElementById(CONFIG.PANEL_ID);
            //     if (!panel) {
            //         this.injectPanelIfMissing();
            //         panel = document.getElementById(CONFIG.PANEL_ID);
            //         if (!panel) return;
            //     }
            //     const visible = panel.style.display !== 'none';
            //     panel.style.display = visible ? 'none' : 'grid';
            //     if (!visible) this.renderPage('themes');
            // },





            togglePanel() {
        if (!state.hasThemeBuilderAccess) {
            return;
        }

        let panel = document.getElementById(CONFIG.PANEL_ID);
        if (!panel) {
            this.injectPanelIfMissing();
            panel = document.getElementById(CONFIG.PANEL_ID);
            if (!panel) return;
        }
        
        const visible = panel.style.display !== 'none';
        
        if (!visible) {
            // ✅ Track that user manually opened the panel
            state.panelWasManuallyOpened = true;
            // ✅ Use !important to override CSS rule
            panel.style.setProperty('display', 'grid', 'important');
            this.renderPage('themes');
        } else {
            state.panelWasManuallyOpened = false;
            // ✅ Use !important to override CSS rule
            panel.style.setProperty('display', 'none', 'important');
        }
    },


            // closePanel() {
            //     const panel = document.getElementById(CONFIG.PANEL_ID);
            //     if (panel) {
            //         panel.style.display = 'none';
            //         themeManager.cancelPreview();
            //     }
            // },



            closePanel() {
        const panel = document.getElementById(CONFIG.PANEL_ID);
        if (panel) {
            panel.style.setProperty('display', 'none', 'important'); // ✅ Use !important to override CSS
            state.panelWasManuallyOpened = false; // ✅ Reset flag
            themeManager.cancelPreview();
        }
    },
            resetCustomizerStateOnRouteChange() {
                state.userOpenedCustomizer = false;
                const panel = document.getElementById(CONFIG.PANEL_ID);
                if (panel) {
                    panel.style.setProperty('display', 'none', 'important'); // ✅ Use !important to override CSS
                }
            },

            renderToolbar() {
                const t = document.getElementById(CONFIG.TOOLBAR_ID);
                if (!t) return;

                // ensure currentPage is set by renderPage()
                const showRemove = state.currentTheme && !['font', 'colors'].includes(this.currentPage);

                t.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; gap:16px;">
                <div style="font-size:14px; color:var(--text-secondary);"></div>

                <div style="display:flex; gap:8px; align-items:center;">
                    ${showRemove ? `
                        <button id="btn-remove" class="btn btn-reset" style="padding:8px 12px; font-size:12px;">
                            Remove Theme
                        </button>
                    ` : ''}
                </div>
            </div>
        `;

                // Attach remove listener only when visible
                if (showRemove) {
                    const btnRemove = document.getElementById('btn-remove');
                    if (btnRemove) {
                        btnRemove.onclick = () => themeManager.removeTheme()
                    }
                }
            },
            // REPLACE ENTIRE uiService.renderPage FUNCTION:
            // renderPage(pageKey) {
            //     // When switching pages, remove any font preview CSS so it doesn't leak into other tabs
            //     if (pageKey !== 'font') {
            //         try { fontService.removePreviewCSS(); } catch (err) { /* ignore if not available */ }
            //     }
            //     document.querySelectorAll('.tc-nav-btn').forEach(btn =>
            //         btn.classList.toggle('active', btn.dataset.page === pageKey)
            //     );
            //     this.currentPage = pageKey;
            //     this.renderToolbar();
            //     const root = document.getElementById(CONFIG.CONTENT_ID);
            //     if (root) root.innerHTML = this.PAGES[pageKey] ? this.PAGES[pageKey]() : '<p>Page not found.</p>';

            //     // run post-render init
            //     if (pageKey === 'font') {
            //         setTimeout(() => {
            //             this.attachFontButtons();
            //         }, 60);
            //     }

            //     // Initialize logo upload functionality when logo page is opened
            //     if (pageKey === 'logo') {
            //         setTimeout(() => {
            //             window.initLogoPageListenersGlobal(); // This is the new/main init function
            //         }, 100);
            //     }
            // },


    renderPage(pageKey) {
        // ✅ FIRST: Check if panel exists and is visible
        const panel = document.getElementById(CONFIG.PANEL_ID);
        if (!panel || panel.style.display === 'none') {
            console.log('Panel not visible, skipping render');
            return;
        }
        
        // When switching pages, remove any font preview CSS
        if (pageKey !== 'font') {
            try { fontService.removePreviewCSS(); } catch (err) { /* ignore */ }
        }
        
        // Update active nav button
        document.querySelectorAll('.tc-nav-btn').forEach(btn =>
            btn.classList.toggle('active', btn.dataset.page === pageKey)
        );
        
        this.currentPage = pageKey;
        this.renderToolbar();
        
        const root = document.getElementById(CONFIG.CONTENT_ID);
        if (root) {
            try {
                // ✅ Use a try-catch to prevent any rendering errors from breaking the UI
                root.innerHTML = this.PAGES[pageKey] ? this.PAGES[pageKey]() : '<p>Page not found.</p>';
            } catch (error) {
                console.error('Error rendering page:', error);
                root.innerHTML = '<p>Error loading content. Please try again.</p>';
            }
        }

        // run post-render init
        if (pageKey === 'font') {
            setTimeout(() => {
                this.attachFontButtons();
            }, 60);
        }

        // Initialize logo upload functionality when logo page is opened
        if (pageKey === 'logo') {
            setTimeout(() => {
                window.initLogoPageListenersGlobal();
            }, 100);
        }
    },

            async loadThemesIntoPopup() {
                const container = document.getElementById('tc-theme-list');
                if (!container) return;

                try {
                    await themeManager.loadThemes();

                    if (state.themes.length === 0) {
                        container.innerHTML = `
                        <div style="text-align: center; color: var(--text-secondary); padding: 20px;">
                            No themes found in backend database.
                        </div>
                    `;
                        return;
                    }

                    container.innerHTML = state.themes.map(theme => {
                        const isActive = state.currentTheme && state.currentTheme._id === theme._id;
                        const color = theme.sidebarGradientStart || '#2563EB';

                        return `
                        <div class="theme-item" data-theme-id="${theme._id}">
                            <div style="display: flex; align-items: center; gap: 10px; flex: 1;">
                                <div style="width: 16px; height: 16px; border-radius: 50%; background: ${color};"></div>
                                <div style="font-weight: 600;">${theme.name}</div>
                            </div>
                            ${isActive ? '<span style="color: #10B981; font-weight: 700;">Active</span>' : ''}
                        </div>
                    `;
                    }).join('');

                    container.querySelectorAll('.theme-item').forEach(item => {
                        const themeId = item.getAttribute('data-theme-id');
                        const theme = state.themes.find(t => t._id === themeId);

                        item.addEventListener('click', () => {
                            themeManager.applyTheme(themeId)
                                .then(() => {
                                    this.showNotification(`"${theme.name}" applied successfully!`, 'success');
                                    this.renderPage('themes');
                                })
                                .catch(error => {
                                    this.showNotification(`Failed to apply theme: ${error.message}`, 'error');
                                });
                        });
                    });

                } catch (error) {
                    container.innerHTML = `
                    <div style="text-align: center; color: #DC2626; padding: 20px;">
                        Failed to load themes: ${error.message}
                    </div>
                `;
                }
            },

            confirmRemoveTheme() {
                if (!state.currentTheme) {
                    this.showNotification('No theme to remove', 'warning');
                    return;
                }

                // Remove theme immediately without confirmation
                themeManager.removeTheme()
                    .then(() => {
                        this.showNotification('Theme removed successfully!', 'success');
                        cacheService.clearCache();
                        this.renderPage('themes');
                    })
                    .catch(error => {
                        this.showNotification(`Failed to remove theme: ${error.message}`, 'error');
                    });
            },

            async refreshAllData() {
                this.showNotification('Refreshing data...', 'info');
                cacheService.clearCache();

                try {
                    await Promise.all([
                        themeManager.loadCurrentTheme(),
                        themeManager.loadThemes(),
                        fontService.loadCurrentFont(),
                        brandColorsService.loadCurrentColors()
                    ]);

                    // Load logo separately and don't show errors if none exists
                    logoService.getAndApplyLogo().catch(() => {
                        // Silently handle no logo case
                    });

                    this.renderPage('themes');
                    this.showNotification('Data refreshed successfully!', 'success');
                } catch (error) {
                    this.showNotification('Failed to refresh data', 'error');
                }
            },



            initFontControls() {
                const fontSelect = document.getElementById('font-family-select');
                const headingSize = document.getElementById('heading-size');
                const contentSize = document.getElementById('content-size');
                const headingDisplay = document.getElementById('heading-size-display');
                const contentDisplay = document.getElementById('content-size-display');
                const previewHeading = document.getElementById('font-preview-heading');
                const previewContent = document.getElementById('font-preview-content');

                const updatePreview = () => {
                    const fontFamily = fontSelect.value;
                    const headingSizeVal = headingSize.value;
                    const contentSizeVal = contentSize.value;

                    // Update display values
                    if (headingDisplay) headingDisplay.textContent = `${headingSizeVal}px`;
                    if (contentDisplay) contentDisplay.textContent = `${contentSizeVal}px`;

                    // Update preview
                    if (previewHeading) {
                        previewHeading.style.fontFamily = fontFamily;
                        previewHeading.style.fontSize = `${headingSizeVal}px`;
                    }
                    if (previewContent) {
                        previewContent.style.fontFamily = fontFamily;
                        previewContent.style.fontSize = `${contentSizeVal}px`;
                    }

                    // Apply live preview to page
                    fontService.applyFontPreviewCSS({
                        fontFamily,
                        headingSize: headingSizeVal,
                        contentSize: contentSizeVal
                    });
                };

                // Add event listeners
                if (fontSelect) {
                    fontSelect.addEventListener('change', updatePreview);
                }
                if (headingSize) {
                    headingSize.addEventListener('input', updatePreview);
                }
                if (contentSize) {
                    contentSize.addEventListener('input', updatePreview);
                }

                // Initial preview update is intentionally omitted to avoid auto-applying preview on tab open.
                // Previews will run only in response to user interactions (change/input events).
            },

            // inside uiService
            updateFontControls(font) {
                if (!font) return;

                const fontSelect = document.getElementById('font-family-select');
                const headingSize = document.getElementById('heading-size');
                const contentSize = document.getElementById('content-size');
                const headingDisplay = document.getElementById('heading-size-display');
                const contentDisplay = document.getElementById('content-size-display');

                if (fontSelect && font.fontFamily) {
                    fontSelect.value = font.fontFamily;
                }
                if (headingSize && font.headingSize != null) {
                    headingSize.value = font.headingSize;
                    if (headingDisplay) headingDisplay.textContent = `${font.headingSize}px`;
                }
                if (contentSize && font.contentSize != null) {
                    contentSize.value = font.contentSize;
                    if (contentDisplay) contentDisplay.textContent = `${font.contentSize}px`;
                }

                // Trigger preview update
                setTimeout(() => uiService.initFontControls(), 100);
            },

            attachFontButtons() {
                const applyBtn = document.getElementById('btn-apply-font');
                const resetBtn = document.getElementById('btn-reset-font');

                if (applyBtn) {
                    applyBtn.onclick = async () => {
                        const fontSelect = document.getElementById('font-family-select');
                        const headingSize = document.getElementById('heading-size');
                        const contentSize = document.getElementById('content-size');

                        if (!fontSelect || !headingSize || !contentSize) {
                            uiService.showNotification('Font controls not found', 'error');
                            return;
                        }

                        const originalHTML = applyBtn.innerHTML;
                        applyBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Applying...';
                        applyBtn.disabled = true;

                        try {
                            // --- THIS IS THE CRITICAL LINE THAT TRIGGERS THE BACKEND SAVE ---
                            await fontService.applyFontSettings({
                                fontFamily: fontSelect.value,
                                headingSize: headingSize.value,
                                contentSize: contentSize.value
                            });
                            // --- END CRITICAL LINE ---

                            // The inner function in fontService handles local CSS application.
                            uiService.showNotification('Font settings saved successfully!', 'success');
                        } catch (error) {
                            uiService.showNotification('Failed to save font settings: ' + (error?.message || error), 'error');
                        } finally {
                            setTimeout(() => {
                                applyBtn.innerHTML = originalHTML;
                                applyBtn.disabled = false;
                            }, 1000);
                        }
                    };
                }

                if (resetBtn) {
                    resetBtn.onclick = async () => {
                        const originalHTML = resetBtn.innerHTML;
                        resetBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Resetting...';
                        resetBtn.disabled = true;

                        try {
                            const defaults = await fontService.resetFont();

                            // Update UI controls
                            const fontSelect = document.getElementById('font-family-select');
                            const headingSize = document.getElementById('heading-size');
                            const contentSize = document.getElementById('content-size');

                            if (fontSelect) fontSelect.value = defaults.fontFamily;
                            if (headingSize) {
                                headingSize.value = defaults.headingSize;
                                const headingDisplay = document.getElementById('heading-size-display');
                                if (headingDisplay) headingDisplay.textContent = `${defaults.headingSize}px`;
                            }
                            if (contentSize) {
                                contentSize.value = defaults.contentSize;
                                const contentDisplay = document.getElementById('content-size-display');
                                if (contentDisplay) contentDisplay.textContent = `${defaults.contentSize}px`;
                            }

                            // Trigger preview update
                            uiService.initFontControls();

                            uiService.showNotification('Font settings reset to default', 'success');
                        } catch (error) {
                            uiService.showNotification('Failed to reset font settings', 'error');
                        } finally {
                            // Restore the reset button's original state immediately
                            resetBtn.innerHTML = originalHTML;
                            resetBtn.disabled = false;
                        }
                    };
                }
            },



            PAGES: {
                themes() {
                    const containerId = 'tc-theme-list';
                    setTimeout(() => uiService.loadThemesIntoPopup(), 50);
                    return `
                    <h2>Themes</h2>
                    <p>Select a theme to apply. Click on a theme to apply it to your dashboard.</p>
                    <div id="${containerId}" style="margin-top:16px;"></div>
                `;
                },
                // INSIDE uiService.PAGES:
                // INSIDE uiService.PAGES:
                // REPLACE ENTIRE uiService.PAGES.logo() FUNCTION
                // REPLACE ENTIRE uiService.PAGES.logo() FUNCTION
                // REPLACE ENTIRE uiService.PAGES.logo() FUNCTION
                logo() {
                    return `
            <h2>Logo Settings</h2>
            <p>Upload your custom logo to replace the default GHLE logo.</p>
            <div style="display:flex; flex-direction:column; gap:16px;">
                
                <div id="upload-area-wrapper" style="position:relative;">
                    <div class="upload-container" style="cursor: default; padding: 40px 20px; text-align: center; border: 2px dashed #d1d5db; border-radius: 12px; background: #f9fafb;">
                        <div style="width: 64px; height: 64px; background: #e5e7eb; border-radius: 12px; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; color: #6b7280; font-size: 28px;">
                            <i class="fas fa-cloud-upload-alt"></i>
                        </div>

                        <h3 style="font-size: 16px; font-weight: 600; color: #111827; margin: 0 0 8px 0;">Click or Drag & Drop File</h3>
                        <p style="color: #6B7280; font-size: 14px; margin: 0;">
                            Max size 5MB. Supports PNG, JPG, SVG.
                        </p>
                    </div>
                    <input type="file" id="logo-upload" accept="image/*" style="position:absolute; inset:0; width:100%; height:100%; opacity:0; cursor:pointer; z-index:2; border-radius:12px;" />
                </div>

                <button id="upload-logo-btn" style="background:#9CA3AF; color:white; padding:14px; border:none; border-radius:10px; font-weight:600; cursor:not-allowed; display:flex; align-items:center; justify-content:center; gap:8px; font-size:15px;" disabled>
                    <i class="fas fa-upload"></i>
                    Select a file to upload
                </button>
                
                <!-- SIMPLE BUTTON - NO FANCY EVENT LISTENERS -->
                <button onclick="logoService.removeLogo()" style="background:#DC2626; color:white; padding:14px; border:none; border-radius:10px; font-weight:600; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; font-size:15px;">
                    <i class="fas fa-trash"></i>
                    Remove Logo
                </button>
            </div>
        `;
                },
                // Replace ONLY the 'font' page in the PAGES object with this:

                // Replace the 'font' page in the PAGES object with this:

                font() {
                    setTimeout(async () => {
                        const savedFont = await fontService.loadCurrentFont();
                        if (savedFont) {
                            document.getElementById('font-family-select').value = savedFont.fontFamily;
                            document.getElementById('heading-size').value = savedFont.headingSize;
                            document.getElementById('heading-size-display').textContent = `${savedFont.headingSize}px`;
                            document.getElementById('content-size').value = savedFont.contentSize;
                            document.getElementById('content-size-display').textContent = `${savedFont.contentSize}px`;
                        }
                        uiService.initFontControls();
                    }, 50);

                    return `
        <div style="max-width: 100%;">
            <div style="margin-bottom: 24px;">
                <h2 style="font-size: 20px; font-weight: 700; color: #111827; margin-bottom: 4px; display: flex; align-items: center; gap: 8px;">
                    <i class="fa-solid fa-font" style="color: #6366f1;"></i>
                    Brand Font
                </h2>
                <p style="color: #6B7280; font-size: 14px; margin: 0;">
                    Customize the font family and sizes across your dashboard
                </p>
            </div>
            
            <!-- Font Family Card -->
            <div style="background: rgba(255, 255, 255, 0.7); border: 1px solid rgba(229, 231, 235, 0.8); border-radius: 12px; padding: 20px; margin-bottom: 16px; backdrop-filter: blur(10px);">
                <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
                    <div style="width: 40px; height: 40px; background: linear-gradient(135deg, #6366F1, #8B5CF6); border-radius: 10px; display: flex; align-items: center; justify-content: center; color: white; font-size: 18px; flex-shrink: 0;">
                        <i class="fas fa-font"></i>
                    </div>
                    <div>
                        <h3 style="font-size: 16px; font-weight: 600; color: #111827; margin: 0;">Font Family</h3>
                        <p style="font-size: 13px; color: #6B7280; margin: 4px 0 0 0;">Choose the primary font for your brand</p>
                    </div>
                </div>
                <div style="position: relative;">
                    <select id="font-family-select" style="width: 100%; padding: 12px 16px; padding-right: 40px; border: 1px solid #D1D5DB; border-radius: 8px; background: white; font-size: 14px; color: #111827; appearance: none; cursor: pointer; transition: all 0.2s ease;">
                        <option value="Arial">Arial</option>
                        <option value="Helvetica">Helvetica</option>
                        <option value="Georgia">Georgia</option>
                        <option value="Times New Roman">Times New Roman</option>
                        <option value="Roboto">Roboto</option>
                        <option value="Open Sans">Open Sans</option>
                        <option value="Montserrat">Montserrat</option>
                        <option value="Lato">Lato</option>
                        <option value="Poppins">Poppins</option>
                        <option value="Inter">Inter</option>
                        <option value="Nunito">Nunito</option>
                        <option value="Source Sans Pro">Source Sans Pro</option>
                    </select>
                    <i class="fas fa-chevron-down" style="position: absolute; right: 16px; top: 50%; transform: translateY(-50%); color: #6B7280; pointer-events: none;"></i>
                </div>
            </div>

            <!-- Heading Size Card -->
            <div style="background: rgba(255, 255, 255, 0.7); border: 1px solid rgba(229, 231, 235, 0.8); border-radius: 12px; padding: 20px; margin-bottom: 16px; backdrop-filter: blur(10px);">
                <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
                    <div style="width: 40px; height: 40px; background: linear-gradient(135deg, #6366F1, #8B5CF6); border-radius: 10px; display: flex; align-items: center; justify-content: center; color: white; font-size: 18px; flex-shrink: 0;">
                        <i class="fas fa-heading"></i>
                    </div>
                    <div>
                        <h3 style="font-size: 16px; font-weight: 600; color: #111827; margin: 0;">Heading Size</h3>
                        <p style="font-size: 13px; color: #6B7280; margin: 4px 0 0 0;">Size for H1-H6 elements (default: 18px)</p>
                    </div>
                </div>
                
                <div style="padding: 8px 0;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                        <span style="font-size: 14px; font-weight: 600; color: #111827; background: #F3F4F6; padding: 4px 12px; border-radius: 6px;" id="heading-size-display">18px</span>
                        <span style="font-size: 12px; color: #6B7280;">12px - 36px</span>
                    </div>
                    
                    <input type="range" id="heading-size" min="12" max="36" value="18" style="width: 100%; height: 6px; background: linear-gradient(to right, #6366F1, #8B5CF6); border-radius: 3px; outline: none; margin: 8px 0; -webkit-appearance: none;">
                    
                    <div style="display: flex; justify-content: space-between; margin-top: 8px; padding: 0 2px;">
                        <span style="font-size: 11px; color: #9CA3AF;">12</span>
                        <span style="font-size: 11px; color: #9CA3AF;">18</span>
                        <span style="font-size: 11px; color: #9CA3AF;">24</span>
                        <span style="font-size: 11px; color: #9CA3AF;">36</span>
                    </div>
                </div>
            </div>

            <!-- Content Size Card -->
            <div style="background: rgba(255, 255, 255, 0.7); border: 1px solid rgba(229, 231, 235, 0.8); border-radius: 12px; padding: 20px; margin-bottom: 24px; backdrop-filter: blur(10px);">
                <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
                    <div style="width: 40px; height: 40px; background: linear-gradient(135deg, #6366F1, #8B5CF6); border-radius: 10px; display: flex; align-items: center; justify-content: center; color: white; font-size: 18px; flex-shrink: 0;">
                        <i class="fas fa-paragraph"></i>
                    </div>
                    <div>
                        <h3 style="font-size: 16px; font-weight: 600; color: #111827; margin: 0;">Content Size</h3>
                        <p style="font-size: 13px; color: #6B7280; margin: 4px 0 0 0;">Size for paragraphs and general text (default: 14px)</p>
                    </div>
                </div>
                
                <div style="padding: 8px 0;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                        <span style="font-size: 14px; font-weight: 600; color: #111827; background: #F3F4F6; padding: 4px 12px; border-radius: 6px;" id="content-size-display">14px</span>
                        <span style="font-size: 12px; color: #6B7280;">12px - 20px</span>
                    </div>
                    
                    <input type="range" id="content-size" min="12" max="20" value="14" style="width: 100%; height: 6px; background: linear-gradient(to right, #6366F1, #8B5CF6); border-radius: 3px; outline: none; margin: 8px 0; -webkit-appearance: none;">
                    
                    <div style="display: flex; justify-content: space-between; margin-top: 8px; padding: 0 2px;">
                        <span style="font-size: 11px; color: #9CA3AF;">12</span>
                        <span style="font-size: 11px; color: #9CA3AF;">14</span>
                        <span style="font-size: 11px; color: #9CA3AF;">16</span>
                        <span style="font-size: 11px; color: #9CA3AF;">20</span>
                    </div>
                </div>
            </div>

            <!-- Action Buttons -->
            <div style="margin-top: 16px; display: block;">
                <button id="btn-apply-font" style="width: 100%; margin-bottom: 12px; padding: 14px 20px; background: linear-gradient(135deg, #111827, #374151); color: white; border: none; border-radius: 10px; font-size: 14px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; transition: all 0.2s ease;">
                    <i class="fas fa-check-circle"></i>
                    Apply Font Settings
                </button>
                <button id="btn-reset-font" style="width: 100%; padding: 14px 20px; background: white; color: #DC2626; border: 1px solid #FECACA; border-radius: 10px; font-size: 14px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; transition: all 0.2s ease;">
                    <i class="fas fa-undo"></i>
                    Reset to Default
                </button>
            </div>
        </div>
        
        <style>
            /* Custom slider thumb for webkit browsers */
            input[type="range"]::-webkit-slider-thumb {
                -webkit-appearance: none;
                appearance: none;
                width: 20px;
                height: 20px;
                border-radius: 50%;
                background: white;
                border: 2px solid #6366F1;
                cursor: pointer;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
                transition: all 0.2s ease;
            }
            
            input[type="range"]::-webkit-slider-thumb:hover {
                transform: scale(1.1);
                box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
            }
            
            /* Custom slider thumb for Firefox */
            input[type="range"]::-moz-range-thumb {
                width: 20px;
                height: 20px;
                border-radius: 50%;
                background: white;
                border: 2px solid #6366F1;
                cursor: pointer;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
            }
            
            /* Select hover/focus states */
            select:hover {
                border-color: #9CA3AF;
            }
            
            select:focus {
                outline: none;
                border-color: #6366F1;
                box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
            }
            
            /* Button hover effects */
            #btn-apply-font:hover {
                transform: translateY(-1px);
                box-shadow: 0 8px 20px rgba(17, 24, 39, 0.2);
                background: linear-gradient(135deg, #1F2937, #4B5563) !important;
            }
            
            #btn-apply-font:active {
                transform: translateY(0);
            }
            
            #btn-reset-font:hover {
                background: #FEF2F2 !important;
                border-color: #FCA5A5 !important;
                transform: translateY(-1px);
            }
            
            #btn-reset-font:active {
                transform: translateY(0);
            }
            
            /* Card hover effect */
            div[style*="background: rgba(255, 255, 255, 0.7); border: 1px solid rgba(229, 231, 235, 0.8);"]:hover {
                border-color: rgba(209, 213, 219, 0.9) !important;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05) !important;
            }
        </style>
        `;
                },
                colors() {
                    return `
                            <h2>Brand Colors</h2>
                            <p>Customize the color scheme of your GHLE dashboard.</p>
                            <div style="display:flex; flex-direction:column; gap:16px;">
                                <div>
                                    <label for="sidebar-color" style="font-weight:600; margin-bottom:6px; display:block;">Sidebar Color</label>
                                    <input type="color" id="sidebar-color" value="#4f46e5" style="width:100%; height:44px; border-radius:8px; cursor:pointer;">
                                    <small style="color:var(--text-secondary); font-size:12px;">Affects the main sidebar background</small>
                                </div>
                                <div>
                                    <label for="header-color" style="font-weight:600; margin-bottom:6px; display:block;">Header Color</label>
                                    <input type="color" id="header-color" value="#7c3aed" style="width:100%; height:44px; border-radius:8px; cursor:pointer;">
                                    <small style="color:var(--text-secondary); font-size:12px;">Affects the top header bar</small>
                                </div>
                                <div>
                                    <label for="background-color" style="font-weight:600; margin-bottom:6px; display:block;">Background Color</label>
                                    <input type="color" id="background-color" value="#f1f5f9" style="width:100%; height:44px; border-radius:8px; cursor:pointer;">
                                    <small style="color:var(--text-secondary); font-size:12px;">Affects the main page background</small>
                                </div>
                                <button onclick="brandColorsService.applyBrandColors({
                                    sidebar: document.getElementById('sidebar-color').value,
                                    header: document.getElementById('header-color').value,
                                    background: document.getElementById('background-color').value
                                })" style="background:#111827; color:#fff; padding:12px 16px; border:none; border-radius:10px; font-weight:600; cursor:pointer;">
                                    Apply Brand Colors
                                </button>
                                <button onclick="brandColorsService.resetBrandColors()" style="background:#DC2626; color:#fff; padding:12px 16px; border:none; border-radius:10px; font-weight:600; cursor:pointer;">
                                    Reset to Default
                                </button>
                            </div>
                        `;
                },
                support() {
                    return `
                <h6>Brand Customization Guide</h6>
                <p>Follow the instructions below to personalize your dashboard with your branding elements. You can customize the Font, Colors, Logo, and Themes to align with your brand identity.</p>
        <br><br><hr>
                <section>
                    <h6>1. Choose Your Theme</h6>
                    <p>Choose a theme and click on it. The dashboard will update automatically.</p>
                    <img src="https://storage.googleapis.com/msgsndr/qzPk2iMXCzGuEt5FA6Ll/media/6927446296891587f387d863.png" alt="Themes Customization" style="width:100%; max-width:600px; margin:20px 0; border-radius:8px;">
                </section>
        <br><br><hr>
                <section>
                    <h6>2. Upload Your Logo</h6>
                    <p>Upload your custom logo to replace the default dashboard logo. It will display at an optimal medium size (120px width).</p>
                    <img src="https://storage.googleapis.com/msgsndr/qzPk2iMXCzGuEt5FA6Ll/media/692744625f7cbc7358c687ef.png" alt="Logo Upload" style="width:100%; max-width:600px; margin:20px 0; border-radius:8px;">
                </section>
                <br><br><hr>
                <section>
                    <h6>3. Customize Brand Font</h6>
                    <p>You can customize the font and it's size for headings and content throughout your dashboard. Select the desired font family, heading size, and content size.</p>
                    <img src="https://storage.googleapis.com/msgsndr/qzPk2iMXCzGuEt5FA6Ll/media/692744621a0c184903ef9996.png" alt="Brand Font Customization" style="width:100%; max-width:600px; margin:20px 0; border-radius:8px;">
                </section>
        <br><br><hr>
                <section>
                    <h6>4. Set Your Brand Colors</h6>
                    <p>Adjust the color scheme of your dashboard, including the sidebar, header, and background color to match your branding.</p>
                    <img src="https://storage.googleapis.com/msgsndr/qzPk2iMXCzGuEt5FA6Ll/media/692744622b23a23955e02fdb.png" alt="Brand Colors Customization" style="width:100%; max-width:600px; margin:20px 0; border-radius:8px;">
                </section>
            
            `;
                }
            }
        };
        // Watch DOM for header icon and mount builder when it appears
        const observer = new MutationObserver(() => {
            const headerIcon = document.getElementById('hl_header--copilot-icon');
            if (headerIcon) {
                uiService.mountBeforeHeaderIcons();   // your existing mount logic
                observer.disconnect();                // stop watching once mounted
            }
        });

        // Start observing the body for changes
        observer.observe(document.body, { childList: true, subtree: true });

        // =========================
        // Global Logo Page Listeners
        // =========================




        window.initLogoPageListenersGlobal = function () {
            // Wait for DOM to be ready
            setTimeout(() => {
                const fileInput = document.getElementById('logo-upload');
                const uploadBtn = document.getElementById('upload-logo-btn');

                if (!fileInput || !uploadBtn) return;

                // Simple file input change listener
                fileInput.addEventListener('change', function () {
                    if (this.files && this.files.length > 0) {
                        uploadBtn.disabled = false;
                        uploadBtn.style.background = '#111827';
                        uploadBtn.style.cursor = 'pointer';
                        uploadBtn.innerHTML = '<i class="fas fa-upload"></i> Upload & Apply Logo';
                    } else {
                        uploadBtn.disabled = true;
                        uploadBtn.style.background = '#9CA3AF';
                        uploadBtn.style.cursor = 'not-allowed';
                        uploadBtn.innerHTML = '<i class="fas fa-upload"></i> Select a file to upload';
                    }
                });

                // Simple upload button click
                uploadBtn.addEventListener('click', async () => {
                    if (uploadBtn.disabled) return;

                    const originalHTML = uploadBtn.innerHTML;
                    uploadBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading...';
                    uploadBtn.disabled = true;

                    try {
                        await logoService.handleLogoUpload();
                        uploadBtn.innerHTML = '<i class="fas fa-check"></i> Uploaded!';
                        uploadBtn.style.background = '#10B981';

                        // Reset after 2 seconds
                        setTimeout(() => {
                            uploadBtn.disabled = true;
                            uploadBtn.style.background = '#9CA3AF';
                            uploadBtn.innerHTML = '<i class="fas fa-upload"></i> Select a file to upload';
                            if (fileInput) fileInput.value = '';
                        }, 2000);

                    } catch (error) {
                        console.error('Upload failed:', error);
                        uploadBtn.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Failed';
                        uploadBtn.style.background = '#DC2626';

                        // Reset after 2 seconds
                        setTimeout(() => {
                            uploadBtn.disabled = true;
                            uploadBtn.style.background = '#9CA3AF';
                            uploadBtn.innerHTML = '<i class="fas fa-upload"></i> Select a file to upload';
                            if (fileInput) fileInput.value = '';
                        }, 2000);
                    }
                });

            }, 100);
        };
        // =========================
        // Utility Functions
        // =========================
        function debounce(func, wait) {
            let timeout;
            return function executedFunction(...args) {
                const later = () => {
                    clearTimeout(timeout);
                    func(...args);
                };
                clearTimeout(timeout);
                timeout = setTimeout(later, wait);
            };
        }




    // async function initializeThemeCustomizer() {
    //     if (!document.body) {
    //         setTimeout(initializeThemeCustomizer, 100);
    //         return;
    //     }

    //     if (state.isInitialized) return;

    //     try {
    //         const currentLocation = urlLocationService.getCurrentLocation();
            
    //         // ✅ Check if customizer should be disabled
    //         if (currentLocation && currentLocation.disableCustomizer) {
    //             console.log('Theme Customizer disabled for this location:', currentLocation);
    //             state.isInitialized = true;
                
    //             // Clean up any existing UI
    //             uiService.removeCustomizerUI();
    //             return;
    //         }
            
    //         if (!currentLocation || !currentLocation.locationId) {
    //             state.isInitialized = true;
    //             return;
    //         }

    //         state.currentLocation = currentLocation;

    //         // Check access only once during initialization
    //         const hasAccess = await accessControlService.checkThemeBuilderAccess(
    //             currentLocation.locationId,
    //             currentLocation.isAgency
    //         );

    //         if (!hasAccess) {
    //             state.isInitialized = true;
    //             uiService.removeCustomizerUI();
    //             return;
    //         }

    //         uiService.ensureScopedCss();
    //         uiService.ensureFA();
    //         uiService.injectPanelIfMissing();

    //         // Mount button only if we have access
    //         if (hasAccess) {
    //             uiService.mountBeforeHeaderIcons();
    //         }

    //         state.isInitialized = true;

    //         // Load data after initialization

    //         setTimeout(() => {
    //             if (state.hasThemeBuilderAccess) {
    //                 Promise.all([
    //                     themeManager.loadCurrentTheme().catch(err => console.warn('Theme load warning:', err)),
    //                     themeManager.loadThemes().catch(err => console.warn('Themes load warning:', err)),
    //                     fontService.loadCurrentFont().catch(err => console.warn('Font load warning:', err)),
    //                     brandColorsService.loadCurrentColors().catch(err => console.warn('Colors load warning:', err))
    //                 ]).then(() => {
    //                     // Load logo separately - don't show errors if no logo exists
    //                     logoService.getAndApplyLogo().catch(() => {
    //                         // Silently fail for no logo - this is expected behavior
    //                     });
    //                 });
    //             }
    //         }, 100);

    //     } catch (error) {
    //         console.error('Failed to initialize Theme Customizer:', error);
    //         state.isInitialized = true;
    //     }
    // }



    // async function initializeThemeCustomizer() {
    //     console.log('=== Theme Customizer INIT START ===');
        
    //     if (!document.body) {
    //         setTimeout(initializeThemeCustomizer, 100);
    //         return;
    //     }

    //     if (state.isInitialized) {
    //         console.log('Already initialized, skipping...');
    //         return;
    //     }

    //     try {
    //         const currentLocation = urlLocationService.getCurrentLocation();
    //         console.log('Current location:', currentLocation);
            
    //         if (!currentLocation || !currentLocation.locationId) {
    //             console.log('No valid location found');
    //             state.isInitialized = true;
    //             return;
    //         }

    //         state.currentLocation = currentLocation;

    //         // Check access
    //         const hasAccess = await accessControlService.checkThemeBuilderAccess(
    //             currentLocation.locationId,
    //             currentLocation.isAgency
    //         );

    //         console.log('Access check result:', hasAccess);

    //         if (!hasAccess) {
    //             console.log('No theme builder access, removing UI...');
    //             state.isInitialized = true;
    //             uiService.removeCustomizerUI();
    //             return;
    //         }

    //         // ✅ CRITICAL: Set this to true!
        
    // state.hasThemeBuilderAccess = hasAccess;
    // console.log(hasAccess ? 'Access granted' : 'Access denied');

    //         uiService.ensureScopedCss();
    //         uiService.ensureFA();
    //         uiService.injectPanelIfMissing();

    //         // Mount button
    //         uiService.mountBeforeHeaderIcons();

    //         state.isInitialized = true;

    //         // Load data after initialization
    //         setTimeout(() => {
    //             if (state.hasThemeBuilderAccess) {
    //                 Promise.all([
    //                     themeManager.loadCurrentTheme().catch(err => console.warn('Theme load warning:', err)),
    //                     themeManager.loadThemes().catch(err => console.warn('Themes load warning:', err)),
    //                     fontService.loadCurrentFont().catch(err => console.warn('Font load warning:', err)),
    //                     brandColorsService.loadCurrentColors().catch(err => console.warn('Colors load warning:', err))
    //                 ]).then(() => {
    //                     // Load logo separately
    //                     logoService.getAndApplyLogo().catch(() => {});
    //                 });
    //             }
    //         }, 100);

    //     } catch (error) {
    //         console.error('Init error:', error);
    //         state.isInitialized = true;
    //     }
    // }


    async function initializeThemeCustomizer() {
        console.log('=== INIT START ===');
        
        if (!document.body) {
            setTimeout(initializeThemeCustomizer, 100);
            return;
        }

        // CRITICAL: If already initialized but access state is unknown/false, reset
        if (state.isInitialized && (state.hasThemeBuilderAccess === false || state.hasThemeBuilderAccess === undefined)) {
            console.log('🔄 Re-initializing due to unknown/negative access state');
            state.isInitialized = false;
        }

        if (state.isInitialized) {
            console.log('✅ Already initialized');
            return;
        }

        try {
            // Get current location from URL
            const currentLocation = urlLocationService.getCurrentLocation();
            
            if (!currentLocation || !currentLocation.locationId) {
                console.log('No location detected, skipping theme customizer for now');
                // Do NOT mark as initialized when there's no location context.
                // This allows the initializer to run again later when a valid
                // location becomes available (prevents permanent skipping).
                state.currentLocation = currentLocation || null;
                return;
            }
            
            console.log('Current location:', currentLocation);
            state.currentLocation = currentLocation;
            
            // ⚠️ IMPORTANT: Check access BEFORE doing anything else
            const hasAccess = await accessControlService.checkThemeBuilderAccess(
                currentLocation.locationId,
                currentLocation.isAgency
            );
            
            console.log('Access result:', hasAccess);
            state.hasThemeBuilderAccess = hasAccess;
            
            if (!hasAccess) {
                console.log('❌ No access - cleaning up and removing all customizations');
                state.hasThemeBuilderAccess = false;
                // Remove UI
                uiService.removeCustomizerUI();
                // Remove all applied CSS/styles from previous customizations
                themeCSSService.removeThemeCSS();
                themeCSSService.removePreviewCSS();
                fontService.removeFontCSS();
                fontService.removePreviewCSS();
                brandColorsService.removeColorsCSS();
                logoService.removeAppliedLogo();
                // Clear localStorage
                localStorage.removeItem('ghl-theme-customizer-logo');
                // Remove cached theme data
                cacheService.clearCache();
                // Clear state
                state.currentTheme = null;
                state.themes = [];
                state.isInitialized = true;  // STILL MARK AS INITIALIZED
                return;
            }
            
            console.log('✅ Access granted - setting up UI');
            uiService.ensureScopedCss();
            // Ensure we have a persistent background to avoid white flash
            try { persistentBgService.ensure(); persistentBgService.installDomObserver(); } catch (e) { console.warn('persistentBgService init failed', e); }
            uiService.ensureFA();
            uiService.injectPanelIfMissing();
            uiService.mountBeforeHeaderIcons();
            
            state.isInitialized = true;
            
            // Load data async
            setTimeout(() => {
                themeManager.loadCurrentTheme().catch(() => {});
                themeManager.loadThemes().catch(() => {});
                fontService.loadCurrentFont().catch(() => {});
                brandColorsService.loadCurrentColors().catch(() => {});
                logoService.getAndApplyLogo().catch(() => {});
            }, 300);
            
        } catch (error) {
            console.error('Init error:', error);
            // STILL MARK AS INITIALIZED (fail-safe)
            state.isInitialized = true;
            state.hasThemeBuilderAccess = false;
            uiService.removeCustomizerUI();
            themeCSSService.removeThemeCSS();
            cacheService.clearCache();
        }
    }


        function ensureThemeVarsStyle() {
    if (document.getElementById('tc-vars-style')) return;
    const style = document.createElement('style');
    style.id = 'tc-vars-style';
    style.textContent = `
        :root { }
        /* example selectors that use the variables */
        .sidebar-v2-location,
        .hl_header,
        .theme-customizer-widget {
        color: var(--ghl-text-color);
        background: var(--ghl-bg-gradient, var(--ghl-bg-color));
        font-family: var(--ghl-font-family);
        }
    `;
    document.head.appendChild(style);
    }




    // Add to your state management
    const locationPersistence = {
        // Store last known valid location
        lastValidLocation: null,
        
        // List of global pages that don't have location context
        globalPages: [
            '/prospecting',
            '/marketplace',
            '/apps',
            '/help',
            '/support',
            '/notifications',
            '/messages'
        ],
        
        isGlobalPage(pathname) {
            return this.globalPages.some(page => pathname.startsWith(page));
        },
        
        updateLocation(newLocation) {
            // Only update if this is a location-specific page
            if (newLocation && !newLocation.isProspectingPage) {
                this.lastValidLocation = newLocation;
            }
            return newLocation;
        },
        
        getPersistedLocation() {
            return this.lastValidLocation;
        }
    };

    // Update the rerunCustomizer function to use persistence:
    // Add this function to prevent auto-opening of panel
    function ensurePanelClosedOnNavigation() {
        const panel = document.getElementById(CONFIG.PANEL_ID);
        if (panel) {
            // Only close if user didn't manually open it
            if (!state.panelWasManuallyOpened) {
                panel.style.setProperty('display', 'none', 'important'); // ✅ Use !important to override CSS
            }
        }
    }

    // Remove event listeners from previous customizer by replacing the panel with a clone
    function cleanupPreviousCustomizer() {
        try {
            const panel = document.getElementById(CONFIG.PANEL_ID);
            if (panel && panel.parentNode) {
                const clone = panel.cloneNode(true);
                panel.parentNode.replaceChild(clone, panel);
                console.debug('cleanupPreviousCustomizer: replaced panel node to remove listeners');
            }

            // Also attempt to clear any temporary global handlers we may have set
            if (window.__tc_domRemovalTraces && Array.isArray(window.__tc_domRemovalTraces)) {
                // keep traces but avoid memory growth here
                if (window.__tc_domRemovalTraces.length > 200) {
                    window.__tc_domRemovalTraces = window.__tc_domRemovalTraces.slice(-100);
                }
            }
        } catch (e) {
            console.warn('cleanupPreviousCustomizer failed', e);
        }
    }

    // Update your rerunCustomizer function to call this:
    function rerunCustomizer() {
        // Clean up previous customizer DOM listeners to avoid stray handlers
        cleanupPreviousCustomizer();

        // Prevent very rapid consecutive reruns which can cause remove/reapply flicker
        const now = Date.now();
        if (now - (state.lastRerunTimestamp || 0) < 500) {
            console.debug('rerunCustomizer: skipping rapid consecutive run');
            return;
        }
        state.lastRerunTimestamp = now;

        const newLoc = urlLocationService.getCurrentLocation();
        const oldLocId = state.currentLocation ? state.currentLocation.locationId : null;

        // Use a persisted last-valid location if the new location has no id
        let effectiveNewLoc = newLoc;
        if (!newLoc || !newLoc.locationId) {
            const persisted = locationPersistence.getPersistedLocation();
            if (persisted && persisted.locationId) {
                effectiveNewLoc = persisted;
            }
        }

        // ✅ Handle prospecting page
        if (newLoc && newLoc.isProspectingPage) {
            const btn = document.getElementById(CONFIG.BTN_ID);
            if (btn) btn.remove();

            // ✅ CRITICAL: Close panel and ensure it stays closed
            uiService.closePanel();
            return;
        }

        // ✅ Handle transition FROM prospecting TO normal page
        if (state.currentLocation && state.currentLocation.isProspectingPage &&
            newLoc && !newLoc.isProspectingPage) {
            console.log('Transition from prospecting to normal page');
            state.currentLocation = newLoc;
            state.isInitialized = false;

            // ✅ CRITICAL: Reset panel state
            state.panelWasManuallyOpened = false;
            uiService.closePanel();

            initializeThemeCustomizer();
            return;
        }

        // If effectiveNewLoc lacks an id, do not clear styling — just ensure UI stays mounted
        if (!effectiveNewLoc || !effectiveNewLoc.locationId) {
            ensurePanelClosedOnNavigation();
            uiService.mountBeforeHeaderIcons();
            return;
        }

        // Only reinitialize if location actually changed
        if (effectiveNewLoc && effectiveNewLoc.locationId === oldLocId) {
            // ✅ Ensure panel stays closed unless user opened it
            ensurePanelClosedOnNavigation();

            uiService.mountBeforeHeaderIcons();
            return;
        }

        // ⚠️ LOCATION CHANGED - Clear all cached data for old location
        console.log('📍 Location changed from', oldLocId, 'to', effectiveNewLoc?.locationId);
        console.log('🧹 Clearing cache and state for location switch');

        // Clear cache immediately
        cacheService.clearCache();

        // Reset state variables
        state.currentTheme = null;
        state.themes = [];
        state.isInitialized = false;
        state.mountRetryCount = 0;

        // ✅ Reset panel state on location change
        state.panelWasManuallyOpened = false;
        uiService.closePanel();

        // Remove all applied CSS/styles from previous location
        themeCSSService.removeThemeCSS();
        themeCSSService.removePreviewCSS();
        fontService.removeFontCSS();
        fontService.removePreviewCSS();
        brandColorsService.removeColorsCSS();
        logoService.removeAppliedLogo();
        
        // Reinitialize for new location
        initializeThemeCustomizer();
    }

        // Force re-run of initializer
        // function rerunCustomizer() {
        //     // 1. Get the new location ID immediately
        //     const newLoc = urlLocationService.getCurrentLocation();
        //     const oldLocId = state.currentLocation ? state.currentLocation.locationId : null;

        //     // 2. SMART CHECK: If the location ID is the same, WE DO NOT RELOAD DATA.
        //     // This prevents the Theme/CSS from being removed and re-added (which causes the flash).
        //     if (newLoc && newLoc.locationId === oldLocId) {
        //         // We just ensure the button exists in the new header and exit.
        //         tryMountHeader(); 
        //         return; 
        //     }

        //     // 3. Only if the Location ID CHANGED (e.g. switched sub-accounts), do we reset and reload.
        //     state.isInitialized = false;
        //     state.mountRetryCount = 0;
            
        //     initializeThemeCustomizer();
        //     tryMountHeader();
        // }

        function tryMountHeader(retries = 0) {
            // loop through your headerContainers list
            for (const selector of headerContainers) {
                const container = document.querySelector(selector);
                if (container) {
                    uiService.mountBeforeHeaderIcons(); // your existing mount logic
                    return;
                }
            }

            // retry if not found yet
            if (retries < state.MAX_MOUNT_RETRIES) {
                setTimeout(() => tryMountHeader(retries + 1), 300);
            } else {
                console.warn('Header container not found after retries');
            }
        }




        // Re-run when using browser back/forward
        window.addEventListener('popstate', rerunCustomizer);

        // Re-run when your SPA uses pushState/replaceState
        (function (history) {
            const wrap = fn => function (...args) {
                const ret = fn.apply(this, args);
                rerunCustomizer();
                return ret;
            };
            history.pushState = wrap(history.pushState);
            history.replaceState = wrap(history.replaceState);
        })(window.history);



        // === Bootstrap ===
        // Call once on page load
        // === Bootstrap ===
        initializeThemeCustomizer();

        // Re-run on browser back/forward
        window.addEventListener('popstate', () => {
            state.isInitialized = false;
            initializeThemeCustomizer();
        });

        // Re-run on SPA navigation (pushState / replaceState)
        (function (history) {
            const rerun = () => {
                state.isInitialized = false;
                initializeThemeCustomizer();
            };

            const wrap = (fn) => function (...args) {
                const result = fn.apply(this, args);
                rerun();
                return result;
            };

            history.pushState = wrap(history.pushState);
            history.replaceState = wrap(history.replaceState);
        })(window.history);


        // =========================
        // Heartbeat
        // =========================
        // function heartbeat() {
        //     // Always re‑detect location
        //     state.currentLocation = urlLocationService.getCurrentLocation();

        //     if (state.hasThemeBuilderAccess) {
        //         // Ensure button exists
        //         if (!document.getElementById(CONFIG.BTN_ID)) {
        //             uiService.mountBeforeHeaderIcons();
        //         }
        //         // Ensure panel exists
        //         if (!document.getElementById(CONFIG.PANEL_ID)) {
        //             uiService.injectPanelIfMissing();
        //         }
        //     } else {
        //         uiService.removeCustomizerUI();
        //     }
        // }


    // function heartbeat() {
    //     // Always re‑detect location
    //     state.currentLocation = urlLocationService.getCurrentLocation();

    //     if (state.hasThemeBuilderAccess) {
    //         // Ensure button exists
    //         if (!document.getElementById(CONFIG.BTN_ID)) {
    //             uiService.mountBeforeHeaderIcons();
    //         }
    //         // Ensure panel exists but keep it closed
    //         if (!document.getElementById(CONFIG.PANEL_ID)) {
    //             uiService.injectPanelIfMissing();
    //             // Immediately close any newly created panel
    //             uiService.closePanel();
    //         }
    //     } else {
    //         uiService.removeCustomizerUI();
    //     }
    // }


    function heartbeat() {
        // Throttle heartbeat to avoid rapid UI toggles
        const nowHB = Date.now();
        if (nowHB - (state.lastHeartbeat || 0) < 500) {
            return;
        }
        state.lastHeartbeat = nowHB;

        // Don't run heartbeat until we have a location
        if (!state.currentLocation) {
            // console.log('Heartbeat skipped - no location');
            return;
        }
        
        // Re-detect location
        const currentLocation = urlLocationService.getCurrentLocation();
        if (currentLocation && currentLocation.locationId !== state.currentLocation?.locationId) {
            console.log('📍 Location changed, updating state');
            state.currentLocation = currentLocation;
        }

        // Only manage UI if we know our access state
        if (state.hasThemeBuilderAccess === true) {
            // Ensure button exists (but not on excluded pages)
            if (!document.getElementById(CONFIG.BTN_ID) && shouldShowButton()) {
                uiService.mountBeforeHeaderIcons();
            }
            
            // Ensure panel exists and keep it closed (unless user manually opened it)
            if (!document.getElementById(CONFIG.PANEL_ID)) {
                uiService.injectPanelIfMissing();
                // ✅ CRITICAL: Close panel immediately on heartbeat injection to prevent auto-opening
                if (!state.panelWasManuallyOpened) {
                    uiService.closePanel();
                }
            }
        } else if (state.hasThemeBuilderAccess === false) {
            // Definitely no access - remove UI
            uiService.removeCustomizerUI();
        }
        // If hasThemeBuilderAccess is undefined/null, we don't know yet - do nothing
    }

    function shouldShowButton() {
        const path = window.location.pathname;
        
        // Pages that should NOT have the button
        const excludedPages = [
            '/page-builder/',
            '/prospecting',
            '/marketplace'
        ];
        
        return !excludedPages.some(page => path.includes(page));
    }

    // Helper function to check if we should mount button
    function shouldMountButton() {
        // Don't mount on page builder pages
        if (window.location.pathname.includes('/page-builder/')) {
            return false;
        }
        
        // Don't mount on prospecting pages
        if (window.location.pathname.includes('/prospecting')) {
            return false;
        }
        
        // Add other exclusions as needed
        return true;
    }
        // =========================
        // Event Listeners
        // =========================
        setInterval(heartbeat, CONFIG.HB_MS);
        window.addEventListener('focus', heartbeat);
        document.addEventListener('visibilitychange', heartbeat, { passive: true });

        document.addEventListener('click', (e) => {
            const nav = e.target.closest('.tc-nav-btn');
            if (nav?.dataset?.page) uiService.renderPage(nav.dataset.page);
        });

        // =========================
        // Public API
        // =========================
        window.GHLThemeCustomizer = {
            init: initializeThemeCustomizer,
            open: () => state.hasThemeBuilderAccess ? uiService.togglePanel() : null,
            close: () => uiService.closePanel(),
            refresh: () => state.hasThemeBuilderAccess ? uiService.refreshAllData() : null,
            getCurrentTheme: () => state.currentTheme,
            getCurrentLocation: () => state.currentLocation,
            getThemes: () => state.themes,
            applyTheme: (themeId) => state.hasThemeBuilderAccess ? themeManager.applyTheme(themeId) : Promise.reject('No theme builder access'),
            removeTheme: () => state.hasThemeBuilderAccess ? themeManager.removeTheme() : Promise.reject('No theme builder access'),
            hasAccess: () => state.hasThemeBuilderAccess,
            isInitialized: () => state.isInitialized,
            fontService: fontService,
            logoService: logoService,
            brandColorsService: brandColorsService,
            // debug: () => {
            //     console.log('GHL Theme Customizer Debug:', {
            //         state: state,
            //         config: CONFIG,
            //         hasThemeBuilderAccess: state.hasThemeBuilderAccess
            //     });
            // }
        };

        window.fontService = fontService;
        window.logoService = logoService;
        window.brandColorsService = brandColorsService;

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initializeThemeCustomizer);
        } else {
            initializeThemeCustomizer();
        }


        // Url Event Listner


        (function () {
            let lastUrl = location.href;
            let checkInProgress = false;

            setInterval(() => {
                if (checkInProgress) return;
                checkInProgress = true;

                try {
                    const currentUrl = location.href;
                    if (currentUrl !== lastUrl) {
                        lastUrl = currentUrl;

                        // reset retries after brief delay to avoid overlapping navigation churn
                        setTimeout(() => {
                            state.mountRetryCount = 0;
                            checkInProgress = false;
                        }, 300);

                        // Don't force immediate mount here; let heartbeat handle mounting.
                        // This avoids double work and potential flashes.
                    } else {
                        checkInProgress = false;
                    }
                } catch (e) {
                    console.warn('URL poll error', e);
                    checkInProgress = false;
                }
            }, 1000);
        })();


        // Manual debug command (can be called from browser console)
        window.debugThemeBuilder = function() {
        console.log('=== MANUAL DEBUG ===');
        console.log('Opening panel...');
        uiService.togglePanel();
        
        console.log('Forcing button mount...');
        uiService.mountBeforeHeaderIcons();
        
        console.log('Checking state...');
        console.log('hasThemeBuilderAccess:', state.hasThemeBuilderAccess);
        console.log('isInitialized:', state.isInitialized);
        console.log('currentLocation:', state.currentLocation);
    };

    })();
































