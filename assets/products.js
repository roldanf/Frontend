(function () {
    'use strict';

    const apiBase = window.LAVALUST_API_BASE_URL;
    const { createApp, computed, onMounted, onBeforeUnmount, reactive, ref } = Vue;

    const app = createApp({
        setup() {
            const accessToken = ref(sessionStorage.getItem('product_access_token') || '');
            const refreshToken = ref(sessionStorage.getItem('product_refresh_token') || '');
            const authenticated = ref(Boolean(accessToken.value || refreshToken.value));
            const authMode = ref('login');
            const authBusy = ref(false);
            const loading = ref(false);
            const saving = ref(false);
            const products = ref([]);
            const currentUser = ref(null);
            const search = ref('');
            const modalOpen = ref(false);
            const editingId = ref(null);
            const searchInput = ref(null);
            const clock = ref('');
            let clockTimer;
            const errorMessage = ref('');
            const successMessage = ref('');
            const credentials = reactive({ username: '', email: '', password: '' });
            const form = reactive({ product_name: '', description: '', price: '', quantity: '' });

            const filteredProducts = computed(() => {
                const needle = search.value.trim().toLowerCase();
                if (!needle) return products.value;
                return products.value.filter((product) =>
                    [product.product_name, product.description, String(product.id)]
                        .some((value) => String(value || '').toLowerCase().includes(needle))
                );
            });
            const isAdmin = computed(() => currentUser.value?.role === 'admin');

            const inventoryUnits = computed(() =>
                products.value.reduce((total, product) => total + Number(product.quantity || 0), 0)
            );

            const inventoryValue = computed(() =>
                products.value.reduce((total, product) =>
                    total + Number(product.price || 0) * Number(product.quantity || 0), 0
                )
            );

            const maxQuantity = computed(() =>
                products.value.reduce((max, product) => Math.max(max, Number(product.quantity || 0)), 0)
            );

            const attentionCount = computed(() =>
                products.value.filter((product) => Number(product.quantity || 0) <= 5).length
            );

            function saveTokens(tokens) {
                accessToken.value = tokens.access_token;
                refreshToken.value = tokens.refresh_token;
                sessionStorage.setItem('product_access_token', tokens.access_token);
                sessionStorage.setItem('product_refresh_token', tokens.refresh_token);
            }

            function clearSession() {
                accessToken.value = '';
                refreshToken.value = '';
                authenticated.value = false;
                currentUser.value = null;
                products.value = [];
                sessionStorage.removeItem('product_access_token');
                sessionStorage.removeItem('product_refresh_token');
            }

            async function readJson(response) {
                const body = await response.text();
                try {
                    return JSON.parse(body);
                } catch (error) {
                    const status = response.status ? ' (HTTP ' + response.status + ')' : '';
                    if (response.status >= 500) {
                        throw new Error('The API returned a server error' + status + '. Check the database schema and server logs.');
                    }
                    throw new Error('The API returned a non-JSON response' + status + '.');
                }
            }

            async function request(path, options, retried) {
                options = options || {};
                const headers = new Headers(options.headers || {});
                if (options.body && !headers.has('Content-Type')) {
                    headers.set('Content-Type', 'application/json');
                }
                if (!options.skipAuth && accessToken.value) {
                    headers.set('Authorization', 'Bearer ' + accessToken.value);
                }

                let response;
                try {
                    response = await fetch(apiBase + path, {
                        method: options.method || 'GET',
                        headers: headers,
                        body: options.body || undefined
                    });
                } catch (error) {
                    throw new Error('Cannot reach the LavaLust API. Check that the PHP server is running and routing /api requests.');
                }
                const data = await readJson(response);

                if (response.status === 401 && !options.skipAuth && !retried && refreshToken.value) {
                    let refreshResponse;
                    try {
                        refreshResponse = await fetch(apiBase + '/refresh', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ refresh_token: refreshToken.value })
                        });
                    } catch (error) {
                        throw new Error('Cannot reach the LavaLust API to refresh your session.');
                    }
                    const refreshed = await readJson(refreshResponse);
                    if (refreshResponse.ok && refreshed.tokens) {
                        saveTokens(refreshed.tokens);
                        return request(path, options, true);
                    }
                    clearSession();
                    throw new Error(refreshed.error || 'Your session has expired. Please sign in again.');
                }

                if (!response.ok) {
                    throw new Error(data.error || 'The request could not be completed.');
                }
                return data;
            }

            function clearNotices() {
                errorMessage.value = '';
                successMessage.value = '';
            }

            async function loadWorkspace() {
                loading.value = true;
                clearNotices();
                try {
                    currentUser.value = await request('/profile');
                    const response = await request('/products');
                    products.value = response.data || [];
                    authenticated.value = true;
                } catch (error) {
                    errorMessage.value = error.message;
                    if (!accessToken.value && !refreshToken.value) {
                        authenticated.value = false;
                    }
                } finally {
                    loading.value = false;
                }
            }

            async function signIn() {
                authBusy.value = true;
                clearNotices();
                try {
                    const response = await request('/login', {
                        method: 'POST',
                        skipAuth: true,
                        body: JSON.stringify({
                            username: credentials.username,
                            password: credentials.password
                        })
                    });
                    saveTokens(response.tokens);
                    authenticated.value = true;
                    credentials.password = '';
                    await loadWorkspace();
                    return true;
                } catch (error) {
                    errorMessage.value = error.message;
                    return false;
                } finally {
                    authBusy.value = false;
                }
            }

            async function register() {
                authBusy.value = true;
                clearNotices();
                try {
                    await request('/create', {
                        method: 'POST',
                        skipAuth: true,
                        body: JSON.stringify({
                            username: credentials.username,
                            email: credentials.email,
                            password: credentials.password
                        })
                    });
                    authMode.value = 'login';
                    if (await signIn()) {
                        successMessage.value = 'Your account is ready.';
                    }
                } catch (error) {
                    errorMessage.value = error.message;
                } finally {
                    authBusy.value = false;
                }
            }

            async function signOut() {
                clearNotices();
                try {
                    if (refreshToken.value) {
                        await request('/logout', {
                            method: 'POST',
                            skipAuth: true,
                            body: JSON.stringify({ refresh_token: refreshToken.value })
                        });
                    }
                } catch (error) {
                    errorMessage.value = 'Could not contact the server to revoke the session. The local session was cleared.';
                } finally {
                    clearSession();
                    modalOpen.value = false;
                }
            }

            function openCreate() {
                editingId.value = null;
                Object.assign(form, { product_name: '', description: '', price: '', quantity: '' });
                clearNotices();
                modalOpen.value = true;
            }

            function openEdit(product) {
                editingId.value = product.id;
                Object.assign(form, {
                    product_name: product.product_name,
                    description: product.description || '',
                    price: String(product.price),
                    quantity: String(product.quantity)
                });
                clearNotices();
                modalOpen.value = true;
            }

            async function saveProduct() {
                saving.value = true;
                clearNotices();
                const isEditing = editingId.value !== null;
                const payload = JSON.stringify({
                    product_name: form.product_name,
                    description: form.description,
                    price: form.price,
                    quantity: Number(form.quantity)
                });
                try {
                    await request(isEditing ? '/products/' + editingId.value : '/products', {
                        method: isEditing ? 'PUT' : 'POST',
                        body: payload
                    });
                    modalOpen.value = false;
                    await loadWorkspace();
                    successMessage.value = isEditing ? 'Product updated.' : 'Product added.';
                } catch (error) {
                    errorMessage.value = error.message;
                } finally {
                    saving.value = false;
                }
            }

            async function removeProduct(product) {
                if (!window.confirm('Delete "' + product.product_name + '"? This cannot be undone.')) return;
                clearNotices();
                try {
                    await request('/products/' + product.id, { method: 'DELETE' });
                    await loadWorkspace();
                    successMessage.value = 'Product deleted.';
                } catch (error) {
                    errorMessage.value = error.message;
                }
            }

            function formatPrice(price) {
                return new Intl.NumberFormat(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                }).format(Number(price || 0));
            }

            function stockStatus(quantity) {
                if (Number(quantity) === 0) return 'Out of stock';
                if (Number(quantity) <= 5) return 'Low stock';
                return 'In stock';
            }

            function gaugeWidth(quantity) {
                const max = maxQuantity.value;
                if (!max) return '0%';
                const pct = (Number(quantity || 0) / max) * 100;
                return (Number(quantity) > 0 ? Math.max(pct, 3) : 0) + '%';
            }

            function onKeydown(event) {
                if (event.key === 'Escape' && modalOpen.value) {
                    modalOpen.value = false;
                    return;
                }
                const tag = (event.target.tagName || '').toLowerCase();
                const typing = tag === 'input' || tag === 'textarea' || event.target.isContentEditable;
                if (event.key === '/' && !typing && authenticated.value && searchInput.value) {
                    event.preventDefault();
                    searchInput.value.focus();
                }
            }

            const tick = () => { clock.value = new Date().toLocaleTimeString([], { hour12: false }); };

            onMounted(() => {
                tick();
                clockTimer = setInterval(tick, 1000);
                document.addEventListener('keydown', onKeydown);
                if (authenticated.value) loadWorkspace();
            });

            onBeforeUnmount(() => {
                clearInterval(clockTimer);
                document.removeEventListener('keydown', onKeydown);
            });

            return {
                authBusy, authMode, authenticated, credentials, currentUser, errorMessage,
                filteredProducts, form, inventoryUnits, inventoryValue, loading, modalOpen,
                products, saving, search, successMessage, editingId, isAdmin, signIn, register, signOut,
                openCreate, openEdit, saveProduct, removeProduct, formatPrice, stockStatus, clearNotices,
                searchInput, attentionCount, gaugeWidth, clock
            };
        },
        template: `
            <div v-if="!authenticated" class="auth">
                <div class="auth-wrap">
                    <section class="win auth-card">
                        <div class="win-bar"><i></i><i></i><i></i><span>auth@lavalust:~ {{ authMode === 'login' ? 'sign-in' : 'register' }}</span></div>
                        <div class="win-body">
                            <h1 class="glitch" data-text="LAVALUST">LAVALUST</h1>
                            <p class="sub">{{ authMode === 'login' ? 'Sign in to manage your product catalog.' : 'Registration creates a standard account.' }}</p>
                            <div v-if="errorMessage" class="notice notice-error" role="alert">{{ errorMessage }}</div>
                            <form @submit.prevent="authMode === 'login' ? signIn() : register()">
                                <label for="username">Username</label>
                                <input id="username" v-model.trim="credentials.username" autocomplete="username" required maxlength="100" placeholder="your_username">
                                <template v-if="authMode === 'register'">
                                    <label for="email">Email address</label>
                                    <input id="email" v-model.trim="credentials.email" type="email" autocomplete="email" required placeholder="you@example.com">
                                </template>
                                <label for="password">Password</label>
                                <input id="password" v-model="credentials.password" type="password" :autocomplete="authMode === 'login' ? 'current-password' : 'new-password'" :minlength="authMode === 'register' ? 8 : 1" required placeholder="••••••••">
                                <button class="button button-primary button-full" type="submit" :disabled="authBusy">
                                    {{ authBusy ? 'Authenticating...' : (authMode === 'login' ? 'Sign in' : 'Create account') }}
                                </button>
                            </form>
                            <p class="auth-switch">
                                {{ authMode === 'login' ? 'New to the workspace?' : 'Already have an account?' }}
                                <button type="button" @click="authMode = authMode === 'login' ? 'register' : 'login'; clearNotices()">
                                    {{ authMode === 'login' ? 'Create an account' : 'Sign in' }}
                                </button>
                            </p>
                        </div>
                    </section>
                </div>
            </div>

            <div v-else class="app">
                <header class="topbar">
                    <a class="brand" href="./" aria-label="LavaLust Products home">
                        <svg class="brand-mark" viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><rect x="3" y="4" width="18" height="4" rx="1"/><rect x="3" y="10" width="12" height="4" rx="1"/><rect x="3" y="16" width="15" height="4" rx="1"/></svg>
                        <span>LavaLust</span>
                    </a>
                    <nav aria-label="Main">
                        <a class="rail-link is-active" href="./" aria-current="page">Products</a>
                        <a v-if="isAdmin" class="rail-link" href="https://api-tester.marasigan.dev/" target="_blank" rel="noopener noreferrer">Users management</a>
                    </nav>
                    <div class="sys">
                        <span class="live">API online</span>
                        <span class="clock">{{ clock }}</span>
                        <div class="rail-user">
                            <span class="account-avatar" aria-hidden="true">{{ (currentUser?.username || 'U').charAt(0).toUpperCase() }}</span>
                            <div class="account-text"><strong>{{ currentUser?.username || 'Account' }}</strong><span>{{ currentUser?.role || 'user' }}</span></div>
                            <button class="button button-ghost button-small" type="button" @click="signOut">Log out</button>
                        </div>
                    </div>
                </header>

                <main class="main">
                    <header class="page-head">
                        <div>
                            <p class="prompt">Welcome back, <b>{{ currentUser?.username || 'there' }}</b></p>
                            <h1>Products</h1>
                            <p class="prompt">Catalog, pricing and available stock.</p>
                        </div>
                        <button v-if="isAdmin" class="button button-primary" type="button" @click="openCreate">+ Add product</button>
                    </header>

                    <div v-if="errorMessage && !modalOpen" class="notice notice-error" role="alert">{{ errorMessage }}</div>
                    <div v-if="successMessage" class="notice notice-success" role="status">{{ successMessage }}</div>

                    <dl class="ledger">
                        <div class="tile" style="--i:0"><dt>Products</dt><dd v-count="[products.length, 0]">0</dd></div>
                        <div class="tile" style="--i:1"><dt>Units in stock</dt><dd v-count="[inventoryUnits, 0]">0</dd></div>
                        <div class="tile" style="--i:2"><dt>Inventory value</dt><dd v-count="[inventoryValue, 2]">0</dd></div>
                        <div class="tile" style="--i:3" :class="{ 'is-alert': attentionCount > 0 }"><dt>Low or out of stock</dt><dd v-count="[attentionCount, 0]">0</dd></div>
                    </dl>

                    <section class="panel">
                        <div class="toolbar">
                            <label class="search-box">
                                <svg viewBox="0 0 24 24" aria-hidden="true"></svg>
                                <input ref="searchInput" v-model="search" type="search" placeholder="name, description or ID" aria-label="Search products">
                                <kbd aria-hidden="true">/</kbd>
                            </label>
                            <p v-if="products.length" class="toolbar-count">{{ filteredProducts.length }} / {{ products.length }} rows</p>
                        </div>

                        <div v-if="loading" class="table-state" role="status">Loading products…</div>
                        <div v-else-if="!filteredProducts.length" class="empty-state">
                            <h3>{{ search ? 'No matching products' : 'No products yet' }}</h3>
                            <p>{{ search ? 'Try another name or ID, or clear the search.' : 'Add your first product to start tracking inventory.' }}</p>
                            <button v-if="!search && isAdmin" class="button button-primary" type="button" @click="openCreate">+ Add product</button>
                        </div>
                        <div v-else class="table-wrap">
                            <table>
                                <thead><tr><th>Product</th><th>Description</th><th class="num">Price</th><th>Quantity</th><th>Status</th><th>Added</th><th v-if="isAdmin"><span class="sr-only">Actions</span></th></tr></thead>
                                <tbody>
                                    <tr v-for="(product, i) in filteredProducts" :key="product.id" :style="{ '--i': Math.min(i, 14) }">
                                        <td><div class="product-cell"><strong>{{ product.product_name }}</strong><span class="product-id">ID {{ product.id }}</span></div></td>
                                        <td class="description-cell">{{ product.description || 'No description' }}</td>
                                        <td class="num price-cell">{{ formatPrice(product.price) }}</td>
                                        <td class="qty-cell">
                                            <span class="qty-value">{{ Number(product.quantity).toLocaleString() }}</span>
                                            <span class="gauge" :class="'gauge-' + stockStatus(product.quantity).toLowerCase().replaceAll(' ', '-')" aria-hidden="true"><span class="gauge-fill" :style="{ width: gaugeWidth(product.quantity) }"></span></span>
                                        </td>
                                        <td><span class="stock-badge" :class="'stock-' + stockStatus(product.quantity).toLowerCase().replaceAll(' ', '-')">{{ stockStatus(product.quantity) }}</span></td>
                                        <td class="date-cell">{{ product.created_at ? new Date(product.created_at.replace(' ', 'T')).toLocaleDateString() : '—' }}</td>
                                        <td v-if="isAdmin"><div class="row-actions">
                                            <button class="link-button" type="button" :aria-label="'Edit ' + product.product_name" @click="openEdit(product)">Edit</button>
                                            <button class="link-button link-danger" type="button" :aria-label="'Delete ' + product.product_name" @click="removeProduct(product)">Delete</button>
                                        </div></td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </section>
                </main>

                <div v-if="modalOpen && isAdmin" class="scrim" @click.self="modalOpen = false">
                    <section class="win drawer" role="dialog" aria-modal="true" :aria-labelledby="editingId ? 'edit-title' : 'create-title'">
                        <div class="win-bar"><i></i><i></i><i></i><span>{{ editingId ? 'nano product_' + editingId + '.json' : 'touch new_product.json' }}</span>
                            <button class="drawer-close" type="button" aria-label="Close" @click="modalOpen = false"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
                        </div>
                        <h2 :id="editingId ? 'edit-title' : 'create-title'">{{ editingId ? 'Edit product' : 'Add product' }}</h2>
                        <form class="drawer-form" @submit.prevent="saveProduct">
                            <div class="drawer-body">
                                <label for="product-name">Product name <span class="required">(required)</span></label>
                                <input id="product-name" v-model.trim="form.product_name" maxlength="100" required placeholder="e.g. Studio headphones">
                                <label for="product-description">Description</label>
                                <textarea id="product-description" v-model="form.description" rows="4" placeholder="Add a short description"></textarea>
                                <div class="form-row">
                                    <div><label for="product-price">Price <span class="required">(required)</span></label><input id="product-price" v-model="form.price" type="number" min="0" max="99999999.99" step="0.01" required placeholder="0.00"></div>
                                    <div><label for="product-quantity">Quantity <span class="required">(required)</span></label><input id="product-quantity" v-model="form.quantity" type="number" min="0" max="2147483647" step="1" required placeholder="0"></div>
                                </div>
                                <div v-if="errorMessage" class="notice notice-error" role="alert">{{ errorMessage }}</div>
                            </div>
                            <div class="drawer-actions">
                                <button class="button button-ghost" type="button" @click="modalOpen = false">Cancel</button>
                                <button class="button button-primary" type="submit" :disabled="saving">{{ saving ? 'Saving...' : (editingId ? 'Save changes' : 'Add product') }}</button>
                            </div>
                        </form>
                    </section>
                </div>
            </div>
        `
    });

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    app.directive('count', {
        mounted(el, binding) { countTo(el, binding.value); },
        updated(el, binding) { if (binding.value[0] !== binding.oldValue[0]) countTo(el, binding.value); },
        unmounted(el) { cancelAnimationFrame(el._raf); }
    });

    function countTo(el, value) {
        const to = Number(value[0]) || 0;
        const decimals = value[1];
        const from = Number(el._val || 0);
        const start = performance.now();
        const show = (n) => { el._val = n; el.textContent = n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }); };
        cancelAnimationFrame(el._raf);
        if (reduceMotion) return show(to);
        const step = (now) => {
            const t = Math.min(1, (now - start) / 900);
            show(from + (to - from) * (1 - Math.pow(1 - t, 3)));
            if (t < 1) el._raf = requestAnimationFrame(step);
        };
        el._raf = requestAnimationFrame(step);
    }

    app.mount('#app');
}());
