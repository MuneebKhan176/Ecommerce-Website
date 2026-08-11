/* ============================================================
   Faisalabad Textile Depot — cart.js
   ------------------------------------------------------------
   - Cart lives in sessionStorage under 'ftd_cart' as
     [{ product_id, quantity }], so it survives a normal page
     navigation (homepage -> /checkout).
   - A genuine hard refresh (F5 / reload button) of THIS PAGE
     wipes the cart before anything reads it. This used to be
     detected purely via the Navigation Timing API, but that
     heuristic misfires in some in-app/mobile browsers, which can
     report a JS-driven redirect (handleBuyNow/handleCheckoutFromCart)
     as a "reload" — wiping the cart before checkout.html ever
     reads it. To fix that, the homepage now sets an explicit
     "I'm intentionally sending you to checkout" flag right before
     redirecting, and the wipe only fires when that flag is absent.
   - Cart.add() only ever adds a product once, at quantity 1.
     Calling it again for the same product is a no-op (returns
     false) instead of bumping the quantity — quantity from then
     on is only changed via the +/- steppers.
   - Cart.add()/Cart.setQuantity() now optionally take a maxQty
     (current stock) so the cap is enforced by Cart itself, not
     just by whichever UI happens to be rendering it.
   ============================================================ */
(function (global) {
    const CART_KEY = 'ftd_cart';
    const BUY_NOW_KEY = 'buy_now_item';
    const NAV_FLAG = 'ftd_checkout_nav';

    function isHardReload() {
        try {
            const entries = performance.getEntriesByType('navigation');
            if (entries && entries.length) return entries[0].type === 'reload';
            // very old browser fallback
            if (performance.navigation) return performance.navigation.type === 1;
        } catch (e) { /* ignore */ }
        return false;
    }

    // Only wipe on a hard reload that WASN'T immediately preceded by an
    // intentional handleBuyNow()/handleCheckoutFromCart() redirect. The
    // flag is set right before those redirects and cleared here on the
    // very next load, so it only ever survives across exactly one
    // navigation.
    if (isHardReload() && !sessionStorage.getItem(NAV_FLAG)) {
        try {
            sessionStorage.removeItem(CART_KEY);
            sessionStorage.removeItem(BUY_NOW_KEY);
        } catch (e) { /* ignore */ }
    }
    try { sessionStorage.removeItem(NAV_FLAG); } catch (e) { /* ignore */ }

    function readRaw() {
        try {
            const raw = sessionStorage.getItem(CART_KEY);
            const parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
            return [];
        }
    }

    function writeRaw(items) {
        try { sessionStorage.setItem(CART_KEY, JSON.stringify(items)); } catch (e) { /* ignore */ }
        try { global.dispatchEvent(new CustomEvent('cart:changed')); } catch (e) { /* ignore */ }
    }

    const Cart = {
        read() {
            return readRaw();
        },

        has(productId) {
            return readRaw().some(i => i.product_id === productId);
        },

        count() {
            return readRaw().reduce((s, i) => s + i.quantity, 0);
        },

        /**
         * Adds a product at quantity 1, but only if it isn't already
         * in the cart AND there's stock for it. Returns true if it was
         * added, false if it was already present or maxQty is 0/undefined-invalid.
         *
         * @param {number} productId
         * @param {number} [maxQty] - current stock for this product, if known.
         *   Omit when the caller doesn't have stock info handy (the cap
         *   is then enforced only by the server / by whichever screen
         *   next calls setQuantity with a maxQty).
         */
        add(productId, maxQty) {
            const items = readRaw();
            if (items.some(i => i.product_id === productId)) return false;
            if (typeof maxQty === 'number' && maxQty < 1) return false; // nothing in stock
            items.push({ product_id: productId, quantity: 1 });
            writeRaw(items);
            return true;
        },

        /**
         * @param {number} productId
         * @param {number} qty
         * @param {number} [maxQty] - current stock; when provided, qty is
         *   clamped to it so the cart can never hold more than what's
         *   actually in stock.
         */
        setQuantity(productId, qty, maxQty) {
            const items = readRaw();
            const item = items.find(i => i.product_id === productId);
            if (!item) return;
            if (typeof maxQty === 'number') qty = Math.min(qty, Math.max(maxQty, 0));
            if (qty < 1) { Cart.remove(productId); return; }
            item.quantity = qty;
            writeRaw(items);
        },

        remove(productId) {
            writeRaw(readRaw().filter(i => i.product_id !== productId));
        },

        clear() {
            writeRaw([]);
        }
    };

    function handleAddToCart(productId, maxQty) {
        return Cart.add(productId, maxQty);
    }

    function handleBuyNow(productId, quantity) {
        try {
            sessionStorage.setItem(BUY_NOW_KEY, JSON.stringify({ product_id: productId, quantity: quantity || 1 }));
            sessionStorage.setItem(NAV_FLAG, '1');
        } catch (e) { /* ignore */ }
        window.location.href = '/checkout?mode=buy_now';
    }

    function handleCheckoutFromCart() {
        if (!Cart.read().length) return;
        try { sessionStorage.setItem(NAV_FLAG, '1'); } catch (e) { /* ignore */ }
        window.location.href = '/checkout?mode=cart';
    }

    global.Cart = Cart;
    global.handleAddToCart = handleAddToCart;
    global.handleBuyNow = handleBuyNow;
    global.handleCheckoutFromCart = handleCheckoutFromCart;
})(window);