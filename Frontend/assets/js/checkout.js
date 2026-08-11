// Frontend/assets/js/checkout.js
//
// Drives Storefront_UI/checkout.html. Reads whichever cart state got the
// buyer here (single "Buy Now" item, or the full cart), re-displays it,
// collects shipping info + payment screenshot, and POSTs it all to
// POST /api/orders — no auth, matches routes/orderRoutes.js.
//
// Expects checkout.html to have:
//   #checkout-items         — container to render the line items into
//   #checkout-form          — the shipping/payment form
//   #full_name #phone #email #city #province #postal_code #address
//   #screenshot              (file input)
//   #place-order-btn
//   #order-result            — where the success/error message goes
//
// IMPORTANT — for this file to work at all:
//   1. cart.js must be loaded BEFORE this file:
//        <script src="/assets/js/cart.js"></script>
//        <script src="/assets/js/checkout.js"></script>
//   2. checkout.html must contain every element ID listed above, exactly.
//   If either of those isn't true, nothing below will render — check the
//   browser console, this file now logs a clear error instead of dying
//   silently.

document.addEventListener('DOMContentLoaded', init);

async function init() {
    const itemsContainer = document.getElementById('checkout-items');
    const form = document.getElementById('checkout-form');
    const resultEl = document.getElementById('order-result');

    if (!itemsContainer || !form) {
        console.error(
            'checkout.js: missing #checkout-items or #checkout-form in the DOM. ' +
            'Nothing will render until checkout.html has both.'
        );
        return;
    }

    if (typeof Cart === 'undefined') {
        console.error(
            'checkout.js: Cart is undefined — cart.js must be loaded BEFORE checkout.js. ' +
            'Check the <script> order in checkout.html.'
        );
        itemsContainer.innerHTML = '<p>Something went wrong loading your cart. Please refresh and try again.</p>';
        return;
    }

    const params = new URLSearchParams(window.location.search);
    const mode = params.get('mode'); // 'buy_now' | 'cart'

    let lineItems = []; // [{product_id, quantity}]

    if (mode === 'buy_now') {
        const staged = sessionStorage.getItem('buy_now_item');
        if (staged) {
            try { lineItems = [JSON.parse(staged)]; } catch (e) { lineItems = []; }
        }
    } else {
        lineItems = Cart.read();
    }

    if (!lineItems.length) {
        itemsContainer.innerHTML = '<p>Your cart is empty.</p>';
        form.style.display = 'none';
        return;
    }

    // Hydrate product details for display, stock caps, and a client-side
    // subtotal preview. The server re-prices and re-validates stock on
    // submit regardless — this is just UI.
    let byId = {};
    try {
        const ids = lineItems.map(i => i.product_id).join(',');
        const res = await fetch(`/api/products?ids=${ids}`);
        const json = await res.json();
        const products = (json.data && json.data.products) || [];
        byId = Object.fromEntries(products.map(p => [p.product_id, p]));
    } catch (e) {
        itemsContainer.innerHTML = '<p>Could not load product details. Please refresh and try again.</p>';
        console.error('checkout.js: failed to fetch /api/products', e);
        return;
    }

    // Drop anything no longer available, and clamp quantity to whatever
    // stock is actually left — this is the "can't order more than stock"
    // requirement, enforced both on load and via the steppers below.
    let items = lineItems
        .filter(i => byId[i.product_id] && byId[i.product_id].is_active && Number(byId[i.product_id].stock) > 0)
        .map(i => {
            const stock = Math.max(Number(byId[i.product_id].stock) || 0, 0);
            return { product_id: i.product_id, quantity: Math.min(Math.max(i.quantity, 1), stock) };
        });

    if (!items.length) {
        itemsContainer.innerHTML = '<p>The item(s) in your cart are no longer available.</p>';
        form.style.display = 'none';
        return;
    }

    function render() {
        let subtotal = 0;

        itemsContainer.innerHTML = items.map(item => {
            const p = byId[item.product_id];
            const stock = Math.max(Number(p.stock) || 0, 0);
            const lineTotal = p.discounted_price * item.quantity;
            subtotal += lineTotal;
            return `
                <div class="checkout-line">
                    <img src="${(p.images && p.images[0]) || ''}" alt="${p.product_name}" />
                    <div>
                        <div>${p.product_name}</div>
                        <div class="checkout-qty-stepper">
                            <button type="button" data-qty-action="dec" data-pid="${item.product_id}" ${item.quantity <= 1 ? 'disabled' : ''}>&minus;</button>
                            <span>Qty: ${item.quantity}</span>
                            <button type="button" data-qty-action="inc" data-pid="${item.product_id}" ${item.quantity >= stock ? 'disabled' : ''}>+</button>
                        </div>
                        <div>${stock} in stock</div>
                        <div>Rs. ${lineTotal.toFixed(2)}</div>
                        <button type="button" data-remove-pid="${item.product_id}">Remove</button>
                    </div>
                </div>
            `;
        }).join('');

        const subtotalEl = document.getElementById('checkout-subtotal');
        if (subtotalEl) subtotalEl.textContent = `Rs. ${subtotal.toFixed(2)}`;

        // Wire up the steppers/remove buttons rendered above.
        itemsContainer.querySelectorAll('[data-qty-action]').forEach(btn => {
            btn.addEventListener('click', () => {
                const pid = Number(btn.dataset.pid);
                const delta = btn.dataset.qtyAction === 'inc' ? 1 : -1;
                changeQty(pid, delta);
            });
        });
        itemsContainer.querySelectorAll('[data-remove-pid]').forEach(btn => {
            btn.addEventListener('click', () => removeItem(Number(btn.dataset.removePid)));
        });
    }

    function changeQty(productId, delta) {
        const item = items.find(i => i.product_id === productId);
        if (!item) return;
        const stock = Math.max(Number(byId[productId].stock) || 0, 0);
        const next = item.quantity + delta;
        if (next < 1 || next > stock) return; // hard stock cap — never exceeds what's in stock
        item.quantity = next;
        if (mode !== 'buy_now') Cart.setQuantity(productId, next); // keep the real cart in sync
        render();
    }

    function removeItem(productId) {
        items = items.filter(i => i.product_id !== productId);
        if (mode !== 'buy_now') Cart.remove(productId);
        if (!items.length) {
            itemsContainer.innerHTML = '<p>Your cart is empty.</p>';
            form.style.display = 'none';
            return;
        }
        render();
    }

    render();

    // ---- Submit ----
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (resultEl) resultEl.textContent = '';

        if (!items.length) return;

        // Last-line stock check before we hit the server, in case stock
        // moved since the page loaded (server enforces this too, this
        // is just a faster/clearer failure for the buyer).
        const overStock = items.find(i => i.quantity > Math.max(Number(byId[i.product_id].stock) || 0, 0));
        if (overStock) {
            if (resultEl) resultEl.textContent = `Only ${byId[overStock.product_id].stock} of "${byId[overStock.product_id].product_name}" left in stock — please adjust the quantity.`;
            return;
        }

        const fd = new FormData();
        fd.append('items', JSON.stringify(items));
        fd.append('full_name', (document.getElementById('full_name') || {}).value?.trim() || '');
        fd.append('phone', (document.getElementById('phone') || {}).value?.trim() || '');
        fd.append('email', (document.getElementById('email') || {}).value?.trim() || '');
        fd.append('city', (document.getElementById('city') || {}).value?.trim() || '');
        fd.append('province', (document.getElementById('province') || {}).value?.trim() || '');
        fd.append('postal_code', (document.getElementById('postal_code') || {}).value?.trim() || '');
        fd.append('address', (document.getElementById('address') || {}).value?.trim() || '');

        const screenshotInput = document.getElementById('screenshot');
        if (screenshotInput && screenshotInput.files[0]) fd.append('screenshot', screenshotInput.files[0]);

        const btn = document.getElementById('place-order-btn');
        if (btn) { btn.disabled = true; btn.textContent = 'Placing order...'; }

        try {
            const orderRes = await fetch('/api/orders', { method: 'POST', body: fd });
            const orderJson = await orderRes.json();

            if (!orderJson.success) {
                if (resultEl) resultEl.textContent = orderJson.message || 'Something went wrong placing your order.';
                if (btn) { btn.disabled = false; btn.textContent = 'Place Order'; }
                return;
            }

            // Order placed — clear whatever staged this checkout.
            if (mode === 'buy_now') sessionStorage.removeItem('buy_now_item');
            else Cart.clear();

            if (resultEl) {
                resultEl.textContent = `Order #${orderJson.data.order_id} placed! Total: Rs. ${orderJson.data.total_price}. Save your order number and phone number to check its status later.`;
            }
            form.style.display = 'none';
        } catch (err) {
            if (resultEl) resultEl.textContent = 'Network error — please try again.';
            if (btn) { btn.disabled = false; btn.textContent = 'Place Order'; }
            console.error('checkout.js: order submission failed', err);
        }
    });
}