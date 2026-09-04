/* =====================================================
   ORYN — Shared JavaScript v2.0
   ===================================================== */

/* ─── LOADER ───────────────────────────────────────── */
window.addEventListener('load', () => {
  setTimeout(() => {
    const ldr = document.getElementById('loader');
    if (ldr) ldr.classList.add('out');
  }, 1700);
});

/* ─── CURSOR ────────────────────────────────────────── */
const cDot  = document.getElementById('cDot');
const cRing = document.getElementById('cRing');
if (cDot && cRing) {
  let mx = 0, my = 0, rx = 0, ry = 0;
  document.addEventListener('mousemove', e => {
    mx = e.clientX; my = e.clientY;
    cDot.style.left = mx + 'px';
    cDot.style.top  = my + 'px';
  });
  (function loop() {
    rx += (mx - rx) * .11;
    ry += (my - ry) * .11;
    cRing.style.left = rx + 'px';
    cRing.style.top  = ry + 'px';
    requestAnimationFrame(loop);
  })();
  document.querySelectorAll('a, button, .ov-card, .ch-card, .prod-card, .img-cover, .gal-item').forEach(el => {
    el.addEventListener('mouseenter', () => document.body.classList.add('cur-hover'));
    el.addEventListener('mouseleave', () => document.body.classList.remove('cur-hover'));
  });
  /* Invert cursor on dark sections */
  const darkSecs = document.querySelectorAll('[data-dark]');
  if (darkSecs.length) {
    const invObs = new IntersectionObserver(() => {
      const mid = window.innerHeight / 2;
      const anyDark = [...darkSecs].some(s => {
        const r = s.getBoundingClientRect();
        return r.top < mid && r.bottom > mid;
      });
      document.body.classList.toggle('cur-inv', anyDark);
    }, { threshold: 0 });
    darkSecs.forEach(s => invObs.observe(s));
  }
}

/* ─── NAVIGATION ────────────────────────────────────── */
const nav = document.getElementById('nav');
if (nav) {
  const heroDark = document.querySelector('[data-hero-dark]');
  const setNavState = () => {
    const scrolled = window.scrollY > 60;
    if (heroDark) {
      nav.classList.toggle('on-light', scrolled);
      nav.classList.toggle('on-dark',  !scrolled);
    } else {
      nav.classList.add('on-light');
      nav.classList.remove('on-dark');
    }
  };
  setNavState();
  window.addEventListener('scroll', setNavState, { passive: true });
  /* Active page highlight */
  const page = location.pathname.split('/').pop() || 'index.html';
  nav.querySelectorAll('.nav-link, .dd-item').forEach(a => {
    const href = a.getAttribute('href') || '';
    if (href === page || (page === '' && href === 'index.html')) {
      a.classList.add('active');
    }
  });
}

/* ─── NAV DROPDOWN CLICK TOGGLE ─────────────────────── */
document.querySelectorAll('.nav-dd-btn').forEach(btn => {
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const dd = btn.closest('.nav-dd');
    const wasOpen = dd.classList.contains('open');
    document.querySelectorAll('.nav-dd.open').forEach(d => d.classList.remove('open'));
    if (!wasOpen) dd.classList.add('open');
  });
});
/* Nested flyout toggle (e.g. "Best Sellers" -> its products) — same
   click/outside-click/Escape pattern as the top-level dropdown above. */
document.querySelectorAll('.dd-flyout-trigger').forEach(btn => {
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const wrap = btn.closest('.dd-item-flyout');
    const wasOpen = wrap.classList.contains('open');
    document.querySelectorAll('.dd-item-flyout.open').forEach(w => w.classList.remove('open'));
    if (!wasOpen) wrap.classList.add('open');
  });
});
document.addEventListener('click', () => {
  document.querySelectorAll('.nav-dd.open, .dd-item-flyout.open').forEach(d => d.classList.remove('open'));
});
document.querySelectorAll('.dd-item, .dd-flyout-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.nav-dd.open, .dd-item-flyout.open').forEach(d => d.classList.remove('open'));
  });
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.querySelectorAll('.nav-dd.open, .dd-item-flyout.open').forEach(d => d.classList.remove('open'));
});

/* ─── HAMBURGER / MOBILE NAV ─────────────────────────── */
const ham    = document.getElementById('ham');
const mobNav = document.getElementById('mob-nav');
let mobOpen  = false;
if (ham && mobNav) {
  ham.addEventListener('click', () => {
    mobOpen = !mobOpen;
    ham.classList.toggle('open', mobOpen);
    mobNav.classList.toggle('open', mobOpen);
    document.body.style.overflow = mobOpen ? 'hidden' : '';
  });
}
function closeMob() {
  if (!ham || !mobNav) return;
  mobOpen = false;
  ham.classList.remove('open');
  mobNav.classList.remove('open');
  document.body.style.overflow = '';
  document.querySelectorAll('#mob-nav .mob-dd.open').forEach(d => d.classList.remove('open'));
}

/* Mobile "Collections" dropdown toggle */
document.querySelectorAll('.mob-dd-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    btn.closest('.mob-dd').classList.toggle('open');
  });
});

/* ─── SCROLL REVEAL ──────────────────────────────────── */
const revObs = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('vis'); });
}, { threshold: .07, rootMargin: '0px 0px -50px 0px' });
document.querySelectorAll('.r, .r-l, .r-r, .r-s').forEach(el => revObs.observe(el));

/* ─── TESTIMONIALS CAROUSEL ───────────────────────────── */
(() => {
  const track = document.getElementById('tsTrack');
  const prevBtn = document.getElementById('tsPrev');
  const nextBtn = document.getElementById('tsNext');
  if (!track || !prevBtn || !nextBtn) return;

  const pages = track.children.length;
  let page = 0;

  const goTo = i => {
    page = (i + pages) % pages;
    const viewport = track.parentElement;
    track.style.transform = `translateX(-${page * viewport.offsetWidth}px)`;
  };

  prevBtn.addEventListener('click', () => goTo(page - 1));
  nextBtn.addEventListener('click', () => goTo(page + 1));
  window.addEventListener('resize', () => goTo(page));
})();

/* ─── TESTIMONIAL READ MORE MODAL ─────────────────────── */
(() => {
  const overlay = document.getElementById('tsModalOverlay');
  if (!overlay) return;
  const closeBtn = document.getElementById('tsModalClose');
  const starsEl = document.getElementById('tsModalStars');
  const textEl = document.getElementById('tsModalText');
  const avatarEl = document.getElementById('tsModalAvatar');
  const nameEl = document.getElementById('tsModalName');

  function openModal(card) {
    const full = card.querySelector('.ts-full');
    starsEl.innerHTML = card.querySelector('.ts-stars').innerHTML;
    textEl.innerHTML = full ? full.innerHTML : `<p>${card.querySelector('.ts-text').textContent.trim()}</p>`;
    avatarEl.textContent = card.querySelector('.ts-avatar').textContent.trim();
    nameEl.textContent = card.querySelector('.ts-name').textContent.trim();
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeModal() {
    overlay.classList.remove('open');
    document.body.style.overflow = '';
  }

  document.querySelectorAll('.ts-readmore').forEach(btn => {
    btn.addEventListener('click', () => {
      const card = btn.closest('.ts-card');
      if (card) openModal(card);
    });
  });
  closeBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && overlay.classList.contains('open')) closeModal(); });
})();

/* ─── PARALLAX (hero dots only) ──────────────────────── */
const heroDots = document.querySelector('.hero-dots');
if (heroDots) {
  window.addEventListener('scroll', () => {
    heroDots.style.transform = `translateY(${window.scrollY * .25}px)`;
  }, { passive: true });
}

/* ─── FAQ ACCORDION ──────────────────────────────────── */
document.querySelectorAll('.faq-item').forEach(item => {
  const q = item.querySelector('.faq-q');
  if (q) q.addEventListener('click', () => {
    const wasOpen = item.classList.contains('open');
    document.querySelectorAll('.faq-item').forEach(i => i.classList.remove('open'));
    if (!wasOpen) item.classList.add('open');
  });
});

/* ─── FORM SUBMIT (posts to the Oryn API, see /server) ───
   The frontend (Netlify / Cloudflare Pages) and the backend (Render) are
   separate origins in production, so a relative "/api/..." fetch resolves
   against whichever static host served this page — not the backend — and
   404s/405s there instead. Only same-origin locally, where server.js
   itself serves these static files alongside the API. */
const API_BASE = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
  ? ''
  : 'https://oryn-1t1j.onrender.com';

document.querySelectorAll('form[data-enquiry]').forEach(form => {
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = form.querySelector('[data-submit]');
    const errorEl = form.querySelector('[data-form-error]');
    if (errorEl) { errorEl.hidden = true; errorEl.textContent = ''; }
    if (!form.reportValidity()) return;

    const type = form.dataset.enquiryType || 'contact';
    const data = new FormData(form);
    const payload = type === 'order' ? {
      fullName: data.get('fullName') || '',
      email: data.get('email') || '',
      phone: data.get('phone') || '',
      address: data.get('address') || '',
      state: data.get('state') || '',
      city: data.get('city') || '',
      pinCode: data.get('pinCode') || '',
      deliveryDate: data.get('deliveryDate') || '',
      product: data.get('product') || '',
      quantityDetails: data.get('quantityDetails') || '',
      giftMessage: data.get('giftMessage') || '',
      cartSummary: (form.querySelector('[data-cart-summary]') || {}).value || '',
      cartItems: readCart(),
    } : {
      fullName: data.get('fullName') || '',
      email: data.get('email') || '',
      phone: data.get('phone') || '',
      subject: data.get('subject') || '',
      message: data.get('message') || '',
    };

    const endpoint = type === 'order' ? '/api/orders' : '/api/contact';
    const orig = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.style.opacity = '.6'; }

    try {
      if (type === 'contact' && window.orynSupabase) {
        // Contact Us form writes straight to Supabase (see js/supabase-config.js).
        const { error } = await window.orynSupabase
          .from('contact_messages')
          .insert({
            full_name: payload.fullName,
            email: payload.email,
            phone: payload.phone,
            subject: payload.subject || null,
            message: payload.message,
          });
        if (error) throw new Error(error.message || 'Request failed');
      } else {
        const res = await fetch(API_BASE + endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(errBody.error || 'Request failed');
        }
        if (type === 'order') {
          const successBody = await res.json().catch(() => ({}));
          // Stashed for order-confirmation.html to read — cart is about to
          // be cleared below, so this is the only copy of what was ordered.
          sessionStorage.setItem('oryn-last-order', JSON.stringify({
            orderId: successBody.id,
            phone: payload.phone,
            items: payload.cartItems,
            subtotal: successBody.subtotal,
          }));
        }
      }

      const successText = form.dataset.successText || 'Enquiry Sent  ✓';
      const redirectUrl = form.dataset.redirectUrl;
      const redirectDelay = Number(form.dataset.redirectDelay || 3200);
      const successTarget = form.dataset.successTarget;

      if (btn) btn.textContent = successText;
      if (successTarget) {
        const target = document.querySelector(successTarget);
        if (target) {
          target.textContent = successText;
          target.hidden = false;
        }
      }

      if (type === 'order') writeCart([]);

      setTimeout(() => {
        if (redirectUrl) {
          window.location.href = redirectUrl;
          return;
        }
        if (btn) {
          btn.textContent = orig;
          btn.disabled = false;
          btn.style.opacity = '1';
        }
        form.reset();
        if (type === 'order') syncCartSummaryField();
      }, redirectDelay);
    } catch (err) {
      if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
      const message = (err && err.message && err.message !== 'Request failed')
        ? err.message
        : "Couldn't send this — please check your connection and try again, or reach us on Instagram @oryn.patisserie.";
      if (errorEl) {
        errorEl.textContent = message;
        errorEl.hidden = false;
      } else {
        alert(message);
      }
    }
  });
});

/* ─── NEWSLETTER SIGNUP (footer form, every page) ─────── */
document.querySelectorAll('.ft-signup-form').forEach(form => {
  const nameInput = form.querySelector('input[name="ft-name"]');
  const input = form.querySelector('input[type="email"]');
  const btn = form.querySelector('button[type="submit"]');
  if (!input || !btn) return;
  const origBtnText = btn.textContent;

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (nameInput && !nameInput.reportValidity()) return;
    if (!input.reportValidity()) return;
    btn.disabled = true;
    btn.textContent = 'Signing Up…';

    try {
      const res = await fetch(API_BASE + '/api/newsletter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: nameInput ? nameInput.value.trim() : '',
          email: input.value,
          sourcePage: location.pathname.split('/').pop() || 'index.html',
        }),
      });
      if (!res.ok) throw new Error('Request failed');
      btn.textContent = 'Signed Up ✓';
      input.value = '';
      if (nameInput) nameInput.value = '';
      setTimeout(() => { btn.textContent = origBtnText; btn.disabled = false; }, 3000);
    } catch (err) {
      btn.textContent = 'Try Again';
      btn.disabled = false;
      setTimeout(() => { btn.textContent = origBtnText; }, 3000);
    }
  });
});

/* ─── CART ─────────────────────────────────────────── */
const CART_STORAGE_KEY = 'oryn-cart-v1';
const CART_PAGE = 'order.html';
const cartCurrency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

const cartItem = (sku, name, price, details) => ({ sku, name, price, details });

const cartPageConfigs = {
  'best-sellers.html': [
    { selector: '#chapters .chapter:nth-of-type(1) a.btn[href="order.html"]', item: cartItem('SAANJH-BOX', 'Saanjh', 400, 'Best Sellers · Box of 6') },
    { selector: '#chapters .chapter:nth-of-type(3) a.btn[href="order.html"]', item: cartItem('HALFHALF-ASSORTED', '1/2 & 1/2 Cookies - Assorted Box', 1000, 'Best Sellers · Assorted · Box of 8') },
  ],
  'muffins.html': [
    { selector: '#chapters .chapter:nth-of-type(1) a.btn[href="order.html"]', item: cartItem('CSB-150', 'Citrus Spice Bloom', 600, 'A Delhi Love Story · Box of 4') },
    { selector: '#chapters .chapter:nth-of-type(2) a.btn[href="order.html"]', item: cartItem('ML-150', 'Mace Latte', 600, 'A Delhi Love Story · Box of 4') },
    { selector: '#chapters .chapter:nth-of-type(3) a.btn[href="order.html"]', item: cartItem('MB-180', 'Matcha Butterscotch', 720, 'A Delhi Love Story · Box of 4') },
    { selector: '#chapters .chapter:nth-of-type(4) a.btn[href="order.html"]', item: cartItem('SCE-150', 'Spiced Cocoa Ember', 600, 'A Delhi Love Story · Box of 4') },
    { selector: '#chapters .chapter:nth-of-type(5) a.btn[href="order.html"]', item: cartItem('SCP-180', 'Salted Caramel Power Crunch', 720, 'A Delhi Love Story · Box of 4') },
  ],
  'cookies.html': [
    { selector: '#cookies-grid .cookie-card:nth-of-type(1) a.btn[href="order.html"]', item: cartItem('AURELIA-BOX', 'Aurelia', 800, 'Cookie Collection · Box of 6 · Pan India') },
    { selector: '#cookies-grid .cookie-card:nth-of-type(2) a.btn[href="order.html"]', item: cartItem('JADECARAMEL-BOX', 'Jade Caramel', 800, 'Cookie Collection · Box of 6 · Pan India') },
    { selector: '#cookies-grid .cookie-card:nth-of-type(3) a.btn[href="order.html"]', item: cartItem('CLOUDCRUMB-BOX', 'Cloud Crumb', 800, 'Cookie Collection · Box of 6 · Pan India') },
  ],
  'cookie-aurelia.html': [
    { selector: '.pdp-btns a.btn[href="order.html"], #box-order a.btn[href="order.html"]', item: cartItem('AURELIA-BOX', 'Aurelia', 800, 'Cookie Collection · Box of 6 · Pan India') },
  ],
  'cookie-cloud-crumb.html': [
    { selector: '.pdp-btns a.btn[href="order.html"], #box-order a.btn[href="order.html"]', item: cartItem('CLOUDCRUMB-BOX', 'Cloud Crumb', 800, 'Cookie Collection · Box of 6 · Pan India') },
  ],
  'cookie-jade-caramel.html': [
    { selector: '.pdp-btns a.btn[href="order.html"], #box-order a.btn[href="order.html"]', item: cartItem('JADECARAMEL-BOX', 'Jade Caramel', 800, 'Cookie Collection · Box of 6 · Pan India') },
  ],
  'flavours-of-india.html': [
    { selector: '#kerala a.btn[href="order.html"]', item: cartItem('MALABAR-ECL', 'Malabar Gold Éclair', 600, 'Flavours of India · Set of 3') },
    { selector: '#kolkata a.btn[href="order.html"]', item: cartItem('NOLEN-CUP', 'Nolen Halo Cupcake', 600, 'Flavours of India · Set of 4') },
    { selector: '#gujarat a.btn[href="order.html"]', item: cartItem('APRICUS-BENTO', 'Apricus Bento Cake', 450, 'Flavours of India · 1 box') },
  ],
  'saanjh.html': [
    { selector: '#hero a.btn[href="order.html"], #product-detail a.btn[href="order.html"], #saanjh-order a.btn[href="order.html"]', item: cartItem('SAANJH-BOX', 'Saanjh', 400, 'Brown Butter Financier · Box of 6 · Pan India') },
  ],
  'banana-cookie-melt.html': [
    { selector: '#bcm-sizes .size-card:nth-of-type(1) a.btn[href="order.html"]', item: cartItem('BCM-350', 'Banana Cookie Melt - Classic Loaf', 350, 'Banana Cookie Melt · 350g · Delhi NCR') },
    { selector: '#bcm-sizes .size-card:nth-of-type(2) a.btn[href="order.html"]', item: cartItem('BCM-500', 'Banana Cookie Melt - Large Loaf', 500, 'Banana Cookie Melt · 500g · Delhi NCR') },
  ],
  'half-and-half-cookies.html': [
    { selector: '#hh-boxes .hh-box-card:nth-of-type(1) a.btn[href="order.html"]', item: cartItem('HALFHALF-SOLSTICE', '1/2 & 1/2 Cookies - Solstice Box', 1000, 'Solstice · Lemon × Blueberry · Box of 8 · Pan India') },
    { selector: '#hh-boxes .hh-box-card:nth-of-type(2) a.btn[href="order.html"]', item: cartItem('HALFHALF-ECLIPSE', '1/2 & 1/2 Cookies - Eclipse Box', 1000, 'Eclipse · Dark Chocolate × Vanilla Confetti · Box of 8 · Pan India') },
    { selector: '#hh-boxes .hh-box-card:nth-of-type(3) a.btn[href="order.html"]', item: cartItem('HALFHALF-ASSORTED', '1/2 & 1/2 Cookies - Assorted Box', 1000, 'Assorted · 4 Solstice + 4 Eclipse · Box of 8 · Pan India') },
  ],
};

/* Master product list, used only to power "You May Also Like" suggestions
   in the cart drawer — every real, orderable product across every collection. */
const PRODUCT_CATALOG = [
  { sku: 'CSB-150', name: 'Citrus Spice Bloom', price: 600, details: 'A Delhi Love Story · Box of 4', href: 'muffin-citrus-spice-bloom.html', image: 'All Product Images/Malabar Gold Éclair/1.png' },
  { sku: 'ML-150', name: 'Mace Latte', price: 600, details: 'A Delhi Love Story · Box of 4', href: 'muffin-mace-latte.html', image: 'All Product Images/Apricus Bento Cake/1.png' },
  { sku: 'MB-180', name: 'Matcha Butterscotch', price: 720, details: 'A Delhi Love Story · Box of 4', href: 'muffin-matcha-butterscotch.html', image: 'All Product Images/Saanjh/1.png' },
  { sku: 'SCE-150', name: 'Spiced Cocoa Ember', price: 600, details: 'A Delhi Love Story · Box of 4', href: 'muffin-spiced-cocoa-ember.html', image: 'All Product Images/Nolen Halo Cupcake/1.png' },
  { sku: 'SCP-180', name: 'Salted Caramel Power Crunch', price: 720, details: 'A Delhi Love Story · Box of 4', href: 'muffin-salted-caramel.html', image: 'All Product Images/Banana Cookie Melt Loaf/1.png' },
  { sku: 'AURELIA-BOX', name: 'Aurelia', price: 800, details: 'Cookie Collection · Box of 6', href: 'cookie-aurelia.html', image: 'All Product Images/All Cookies/Aurelia Cookies/2.png' },
  { sku: 'JADECARAMEL-BOX', name: 'Jade Caramel', price: 800, details: 'Cookie Collection · Box of 6', href: 'cookie-jade-caramel.html', image: 'All Product Images/All Cookies/Oryn - Invitation-12.png' },
  { sku: 'CLOUDCRUMB-BOX', name: 'Cloud Crumb', price: 800, details: 'Cookie Collection · Box of 6', href: 'cookie-cloud-crumb.html', image: 'All Product Images/All Cookies/Oryn - Invitation-17.png' },
  { sku: 'ACC-500', name: 'Almond Cinnamon Cookies', price: 500, details: 'WOH DIN - Yaad Hai? · Pack of 4', href: 'almond-cinnamon-cookies.html', image: 'All Product Images/Almond Cinnamon Cookies/1.jpg' },
  { sku: 'ACB-500', name: 'Almond Chocolate Biscotti', price: 500, details: 'WOH DIN - Yaad Hai? · Pack of 6', href: 'almond-chocolate-biscotti.html', image: 'All Product Images/Almond Chocolate Biscotti/1.jpg' },
  { sku: 'ANTC-600', name: 'Almond & Nuts Tea Cake', price: 600, details: 'WOH DIN - Yaad Hai? · 1 loaf', href: 'almond-nuts-tea-cake.html', image: 'All Product Images/Almond Nuts Tea Cake/1.jpg' },
  { sku: 'DCAB-400', name: 'Dark Chocolate Almond Bars', price: 400, details: 'WOH DIN - Yaad Hai? · Pack of 4', href: 'dark-chocolate-almond-bars.html', image: 'All Product Images/Dark Chocolate Almond Bars/1.jpg' },
  { sku: 'MALABAR-ECL', name: 'Malabar Gold Éclair', price: 600, details: 'Flavours of India · Set of 3', href: 'eclair-malabar-gold.html', image: 'All Product Images/Malabar Gold Éclair/1.png' },
  { sku: 'NOLEN-CUP', name: 'Nolen Halo Cupcake', price: 600, details: 'Flavours of India · Set of 4', href: 'cupcake-nolen-halo.html', image: 'All Product Images/Nolen Halo Cupcake/1.png' },
  { sku: 'APRICUS-BENTO', name: 'Apricus Bento Cake', price: 450, details: 'Flavours of India · 1 box', href: 'bento-apricus.html', image: 'All Product Images/Apricus Bento Cake/1.png' },
  { sku: 'SAANJH-BOX', name: 'Saanjh', price: 400, details: 'Best Sellers · Box of 6', href: 'saanjh.html', image: 'All Product Images/Saanjh/1.png' },
  { sku: 'BCM-350', name: 'Banana Cookie Melt', price: 350, details: 'Best Sellers · 350g', href: 'banana-cookie-melt.html', image: 'All Product Images/Banana Cookie Melt Loaf/1.png' },
  { sku: 'HALFHALF-ASSORTED', name: '1/2 & 1/2 Cookies', price: 1000, details: 'Best Sellers · Box of 8', href: 'half-and-half-cookies.html', image: 'All Product Images/Half and Half Cookies/eclipse-standing.png' },
];

/* Fisher-Yates — used so "You May Also Like" never repeats the same order twice. */
function shuffleArray(input) {
  const arr = input.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function currentPageName() {
  return location.pathname.split('/').pop() || 'index.html';
}

function readCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function formatCartPrice(value) {
  return cartCurrency.format(value).replace('.00', '');
}

function writeCart(items) {
  localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
  updateCartIndicators();
  syncCartSummaryField();
  renderCartPage();
  renderCartDrawer();
}

function attachCartData(element, item) {
  element.dataset.addToCart = 'true';
  element.dataset.cartSku = item.sku;
  element.dataset.cartName = item.name;
  element.dataset.cartPrice = String(item.price);
  element.dataset.cartDetails = item.details;
}

function configureCartButtons() {
  const config = cartPageConfigs[currentPageName()] || [];
  config.forEach(({ selector, item, options }) => {
    document.querySelectorAll(selector).forEach(element => {
      attachCartData(element, item, options);
    });
  });
}

function buildCartItem(element) {
  return {
    sku: element.dataset.cartSku,
    name: element.dataset.cartName,
    price: Number(element.dataset.cartPrice || 0),
    details: element.dataset.cartDetails || '',
    quantity: 1,
  };
}

function addItemToCart(item) {
  const items = readCart();
  const existing = items.find(entry => entry.sku === item.sku);
  if (existing) {
    existing.quantity += item.quantity || 1;
  } else {
    items.push(item);
  }
  writeCart(items);
}

/* ─── CART DRAWER (slides in from the right on every "Add to Cart") ─── */
function ensureCartDrawer() {
  if (document.getElementById('cart-drawer-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'cart-drawer-overlay';
  overlay.className = 'cart-drawer-overlay';
  overlay.innerHTML = `
    <aside class="cart-drawer" role="dialog" aria-modal="true" aria-label="Your cart">
      <div class="cart-drawer-head">
        <h3 class="cart-drawer-title">Your Cart <span data-cart-drawer-count>(0)</span></h3>
        <button type="button" class="cart-drawer-close" data-cart-drawer-close aria-label="Close cart">×</button>
      </div>
      <div class="cart-drawer-body" data-cart-drawer-body></div>
      <div class="cart-drawer-foot" data-cart-drawer-foot></div>
    </aside>`;
  document.body.appendChild(overlay);

  overlay.addEventListener('click', event => {
    if (event.target === overlay || event.target.closest('[data-cart-drawer-close]')) {
      closeCartDrawer();
      return;
    }
    const qtyBtn = event.target.closest('[data-cart-action]');
    if (qtyBtn) {
      const action = qtyBtn.dataset.cartAction;
      const sku = qtyBtn.dataset.cartSku;
      let next = readCart();
      if (action === 'increment') next = next.map(i => i.sku === sku ? { ...i, quantity: i.quantity + 1 } : i);
      if (action === 'decrement') next = next.map(i => i.sku === sku ? { ...i, quantity: i.quantity - 1 } : i).filter(i => i.quantity > 0);
      if (action === 'remove') next = next.filter(i => i.sku !== sku);
      writeCart(next);
      return;
    }
    const suggestBtn = event.target.closest('[data-cart-suggest-add]');
    if (suggestBtn) {
      const product = PRODUCT_CATALOG.find(p => p.sku === suggestBtn.dataset.cartSuggestAdd);
      if (product) {
        addItemToCart({ sku: product.sku, name: product.name, price: product.price, details: product.details, quantity: 1 });
      }
    }
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && overlay.classList.contains('open')) closeCartDrawer();
  });
}

function openCartDrawer() {
  ensureCartDrawer();
  renderCartDrawer();
  document.getElementById('cart-drawer-overlay').classList.add('open');
  document.body.classList.add('cart-drawer-locked');
}

function closeCartDrawer() {
  const overlay = document.getElementById('cart-drawer-overlay');
  if (!overlay) return;
  overlay.classList.remove('open');
  document.body.classList.remove('cart-drawer-locked');
}

function cartThumbHtml(sku, extraClass) {
  const product = PRODUCT_CATALOG.find(p => p.sku === sku);
  if (product && product.image) {
    return `<div class="${extraClass}"><img src="${product.image}" alt="${product.name}" loading="lazy"></div>`;
  }
  return `<div class="${extraClass} ph" data-ph=""></div>`;
}

function renderCartDrawer() {
  const overlay = document.getElementById('cart-drawer-overlay');
  if (!overlay) return;

  const items = readCart();
  const count = items.reduce((total, item) => total + item.quantity, 0);
  overlay.querySelector('[data-cart-drawer-count]').textContent = `(${count})`;

  const body = overlay.querySelector('[data-cart-drawer-body]');
  const foot = overlay.querySelector('[data-cart-drawer-foot]');

  if (!items.length) {
    body.innerHTML = `
      <div class="cart-drawer-empty">
        <p class="cart-drawer-empty-title">Your cart is empty.</p>
        <p class="cart-drawer-empty-copy">Add something from any collection and it will show up here.</p>
      </div>`;
    foot.innerHTML = '';
    return;
  }

  const inCartSkus = new Set(items.map(item => item.sku));
  const suggestions = shuffleArray(PRODUCT_CATALOG.filter(p => !inCartSkus.has(p.sku))).slice(0, 3);
  const suggestHtml = suggestions.length ? `
    <div class="cart-drawer-suggest">
      <p class="cart-drawer-suggest-head">You May Also Like</p>
      <div class="cart-drawer-suggest-list">
        ${suggestions.map(p => `
          <div class="cart-drawer-suggest-item">
            ${cartThumbHtml(p.sku, 'cart-drawer-suggest-thumb')}
            <div class="cart-drawer-suggest-info">
              <p class="cart-drawer-suggest-name">${p.name}</p>
              <p class="cart-drawer-suggest-price">${formatCartPrice(p.price)}</p>
            </div>
            <button type="button" class="cart-drawer-suggest-add" data-cart-suggest-add="${p.sku}">Add</button>
          </div>`).join('')}
      </div>
    </div>` : '';

  const subtotal = items.reduce((total, item) => total + item.price * item.quantity, 0);

  body.innerHTML = `
    <div class="cart-drawer-list">
      ${items.map(item => `
        <div class="cart-drawer-item">
          ${cartThumbHtml(item.sku, 'cart-drawer-thumb')}
          <div class="cart-drawer-item-info">
            <p class="cart-drawer-item-name">${item.name}</p>
            <p class="cart-drawer-item-meta">${item.details || ''}</p>
            <div class="cart-drawer-qty" aria-label="Quantity controls for ${item.name}">
              <button type="button" data-cart-action="decrement" data-cart-sku="${item.sku}" aria-label="Decrease quantity">−</button>
              <span>${item.quantity}</span>
              <button type="button" data-cart-action="increment" data-cart-sku="${item.sku}" aria-label="Increase quantity">+</button>
            </div>
          </div>
          <div class="cart-drawer-item-side">
            <p class="cart-drawer-item-price">${formatCartPrice(item.price * item.quantity)}</p>
            <button type="button" class="cart-drawer-remove" data-cart-action="remove" data-cart-sku="${item.sku}">Remove</button>
          </div>
        </div>`).join('')}
    </div>
    ${suggestHtml}`;

  foot.innerHTML = `
    <div class="cart-drawer-total">
      <span>Estimated Total</span>
      <strong>${formatCartPrice(subtotal)}</strong>
    </div>
    <a href="order.html#cart" class="btn btn-b cart-drawer-checkout">View Cart &amp; Enquire</a>`;
}

function ensureCartIndicators() {
  document.querySelectorAll('#nav a[href="order.html"], #mob-nav a[href="order.html"]').forEach(link => {
    if (link.querySelector('[data-cart-count]')) return;
    link.classList.add('has-cart-badge');
    const badge = document.createElement('span');
    badge.className = 'cart-count-badge';
    badge.dataset.cartCount = 'true';
    badge.hidden = true;
    link.appendChild(badge);
  });
}

function updateCartIndicators() {
  const count = readCart().reduce((total, item) => total + item.quantity, 0);
  document.querySelectorAll('[data-cart-count]').forEach(badge => {
    badge.hidden = count === 0;
    badge.textContent = String(count);
  });
}

function syncCartSummaryField() {
  const field = document.querySelector('[data-cart-summary]');
  if (!field) return;
  const items = readCart();
  if (!items.length) {
    field.value = 'Your cart is currently empty. You can still use this form for custom or gifting enquiries.';
    return;
  }
  field.value = items.map(item => `${item.quantity} × ${item.name} — ${formatCartPrice(item.price * item.quantity)}${item.details ? ` (${item.details})` : ''}`).join('\n');
}

function renderCartPage() {
  const root = document.querySelector('[data-cart-root]');
  if (!root) return;
  const isCheckout = root.dataset.cartMode === 'checkout';
  const items = readCart();
  if (!root.dataset.bound) {
    root.addEventListener('click', event => {
      const control = event.target.closest('[data-cart-action]');
      if (!control) return;
      const action = control.dataset.cartAction;
      const sku = control.dataset.cartSku;
      let next = readCart();
      if (action === 'clear') {
        next = [];
      }
      if (action === 'increment') {
        next = next.map(item => item.sku === sku ? { ...item, quantity: item.quantity + 1 } : item);
      }
      if (action === 'decrement') {
        next = next.map(item => item.sku === sku ? { ...item, quantity: item.quantity - 1 } : item).filter(item => item.quantity > 0);
      }
      if (action === 'remove') {
        next = next.filter(item => item.sku !== sku);
      }
      writeCart(next);
    });
    root.dataset.bound = 'true';
  }

  if (!items.length) {
    root.innerHTML = `
      <div class="cart-empty">
        <span class="eye eye-b mb16">Cart</span>
        <h3 class="cart-empty-title">Your cart is empty.</h3>
        <p class="cart-empty-copy">Add products from any product or collection page and they will appear here instantly.</p>
        <div class="cart-empty-links">
          <a href="muffins.html" class="btn btn-b btn-sm">Browse Muffins</a>
          <a href="cookies.html" class="btn btn-ob btn-sm">Browse Cookies</a>
        </div>
      </div>`;
    return;
  }

  const subtotal = items.reduce((total, item) => total + (item.price * item.quantity), 0);
  const count = items.reduce((total, item) => total + item.quantity, 0);
  const rows = items.map(item => `
    <article class="cart-item">
      <div class="cart-item-main">
        <p class="cart-item-name">${item.name}</p>
        <p class="cart-item-meta">${item.details || ''}</p>
        <p class="cart-item-unit">${formatCartPrice(item.price)} each</p>
      </div>
      <div class="cart-item-side">
        <div class="cart-qty" aria-label="Quantity controls for ${item.name}">
          <button type="button" data-cart-action="decrement" data-cart-sku="${item.sku}" aria-label="Decrease quantity">−</button>
          <span>${item.quantity}</span>
          <button type="button" data-cart-action="increment" data-cart-sku="${item.sku}" aria-label="Increase quantity">+</button>
        </div>
        <p class="cart-item-total">${formatCartPrice(item.price * item.quantity)}</p>
        <button type="button" class="cart-remove" data-cart-action="remove" data-cart-sku="${item.sku}">Remove</button>
      </div>
    </article>`).join('');

  root.innerHTML = `
    <div class="cart-shell">
      <div class="cart-panel">
        <div class="cart-panel-head">
          <div>
            <span class="eye eye-b mb8">Cart</span>
            <h3 class="cart-head">Current Selection</h3>
          </div>
          <button type="button" class="cart-clear" data-cart-action="clear">Clear Cart</button>
        </div>
        <div class="cart-list">${rows}</div>
      </div>
      <aside class="cart-summary">
        <span class="eye eye-b mb8">Summary</span>
        <h3 class="cart-head">Order Snapshot</h3>
        <div class="cart-summary-row"><span>Total Items</span><strong>${count}</strong></div>
        <div class="cart-summary-row"><span>Subtotal</span><strong>${formatCartPrice(subtotal)}</strong></div>
        <p class="cart-summary-note">${isCheckout
          ? 'Shipping and delivery confirmation are finalised once you complete the billing details below.'
          : 'Shipping, delivery confirmation, and availability are finalised after enquiry based on the product mix and delivery zone.'}</p>
        <div class="cart-summary-actions">
          ${isCheckout
            ? '<a href="muffins.html" class="btn btn-ob">Keep Shopping</a>'
            : '<a href="checkout.html" class="btn btn-b">Complete Order</a><a href="muffins.html" class="btn btn-ob">Keep Shopping</a>'}
        </div>
      </aside>
    </div>`;
}

function bindCartButtons() {
  document.querySelectorAll('[data-add-to-cart]').forEach(element => {
    if (element.dataset.cartBound) return;
    element.dataset.cartBound = 'true';
    element.addEventListener('click', event => {
      event.preventDefault();
      const item = buildCartItem(element);
      if (!item.sku) return;
      addItemToCart(item);
      openCartDrawer();
    });
  });
}

configureCartButtons();
ensureCartIndicators();
bindCartButtons();
updateCartIndicators();
syncCartSummaryField();
renderCartPage();

/* ─── SMOOTH ANCHOR ──────────────────────────────────── */
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    const id = a.getAttribute('href').slice(1);
    const target = document.getElementById(id);
    if (target) { e.preventDefault(); target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });
});

/* ─── PAGE LEAVE TRANSITION ──────────────────────────── */
document.querySelectorAll('a[href]').forEach(a => {
  const href = a.getAttribute('href');
  if (!href || href.startsWith('#') || href.startsWith('mailto') || href.startsWith('tel')) return;
  a.addEventListener('click', e => {
    /* Let browser handle normally — just add subtle visual */
  });
});

/* ─── EDITION GALLERY — inline carousel + fullscreen modal ──────────── */
(function () {
  const galleryEls = document.querySelectorAll('.ec-gallery[data-gallery]');
  if (!galleryEls.length) return;

  function buildSlideBody(src, label, num) {
    if (src) {
      const img = document.createElement('img');
      img.src = src;
      img.alt = label ? `${label} — photo ${num}` : `Photo ${num}`;
      img.loading = 'lazy';
      img.draggable = false;
      return img;
    }
    const frag = document.createDocumentFragment();
    const numEl = document.createElement('span');
    numEl.className = 'eg-num';
    numEl.textContent = String(num).padStart(2, '0');
    const lblEl = document.createElement('span');
    lblEl.className = 'eg-ph-label';
    lblEl.textContent = label || 'Coming Soon';
    frag.appendChild(numEl);
    frag.appendChild(lblEl);
    return frag;
  }

  function bindDrag(track, onSwipe, getIndex) {
    let dragging = false, startX = 0, delta = 0;
    const start = x => { dragging = true; startX = x; delta = 0; track.classList.add('dragging'); };
    const move  = x => { if (!dragging) return; delta = x - startX; track.style.transform = `translateX(calc(-${getIndex() * 100}% + ${delta}px))`; };
    const end   = () => {
      if (!dragging) return;
      dragging = false;
      track.classList.remove('dragging');
      if (Math.abs(delta) > 60) onSwipe(delta < 0 ? 1 : -1);
      else onSwipe(0);
    };
    track.addEventListener('mousedown', e => start(e.clientX));
    window.addEventListener('mousemove', e => move(e.clientX));
    window.addEventListener('mouseup', end);
    track.addEventListener('touchstart', e => start(e.touches[0].clientX), { passive: true });
    track.addEventListener('touchmove', e => move(e.touches[0].clientX), { passive: true });
    track.addEventListener('touchend', end);
  }

  const galleries = [];

  galleryEls.forEach(el => {
    const label  = el.dataset.label || '';
    const images = (el.dataset.images || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    const count = images.length || parseInt(el.dataset.count, 10) || 0;
    if (!count) return;

    el.innerHTML = '';

    const viewport = document.createElement('div');
    viewport.className = 'eg-viewport';
    const track = document.createElement('div');
    track.className = 'eg-track';
    for (let i = 0; i < count; i++) {
      const slide = document.createElement('div');
      slide.className = 'eg-slide';
      slide.appendChild(buildSlideBody(images[i], label, i + 1));
      track.appendChild(slide);
    }
    viewport.appendChild(track);

    const prev = document.createElement('button');
    prev.type = 'button'; prev.className = 'eg-arrow eg-prev'; prev.setAttribute('aria-label', 'Previous image'); prev.textContent = '‹';
    const next = document.createElement('button');
    next.type = 'button'; next.className = 'eg-arrow eg-next'; next.setAttribute('aria-label', 'Next image'); next.textContent = '›';
    viewport.appendChild(prev);
    viewport.appendChild(next);
    el.appendChild(viewport);

    const dots = document.createElement('div');
    dots.className = 'eg-dots';
    const dotEls = [];
    for (let i = 0; i < count; i++) {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'eg-dot';
      dot.setAttribute('aria-label', `Go to image ${i + 1}`);
      dots.appendChild(dot);
      dotEls.push(dot);
    }
    el.appendChild(dots);

    let index = 0;
    function go(i) {
      index = Math.max(0, Math.min(count - 1, i));
      track.style.transform = `translateX(-${index * 100}%)`;
      dotEls.forEach((d, di) => d.classList.toggle('active', di === index));
      prev.hidden = index === 0;
      next.hidden = index === count - 1;
    }
    prev.addEventListener('click', () => go(index - 1));
    next.addEventListener('click', () => go(index + 1));
    dotEls.forEach((d, di) => d.addEventListener('click', () => go(di)));
    bindDrag(track, dir => go(index + dir), () => index);
    go(0);

    galleries.push({ el, label, images, count });
  });

  /* ── Fullscreen modal (mobile "View Gallery" opener) ── */
  const modal = document.getElementById('eg-modal');
  if (!modal) return;
  const modalTrack = modal.querySelector('.eg-modal-track');
  const modalCount = modal.querySelector('.eg-modal-count');
  const modalPrev  = modal.querySelector('.eg-modal-prev');
  const modalNext  = modal.querySelector('.eg-modal-next');
  const modalClose = modal.querySelector('.eg-modal-close');

  let activeGallery = null;
  let modalIndex = 0;

  function updateModal() {
    modalTrack.style.transform = `translateX(-${modalIndex * 100}%)`;
    if (modalCount && activeGallery) modalCount.textContent = `${modalIndex + 1} / ${activeGallery.count}`;
  }
  function openModal(gallery) {
    activeGallery = gallery;
    modalIndex = 0;
    modalTrack.innerHTML = '';
    for (let i = 0; i < gallery.count; i++) {
      const slide = document.createElement('div');
      slide.className = 'eg-slide';
      slide.appendChild(buildSlideBody(gallery.images[i], gallery.label, i + 1));
      modalTrack.appendChild(slide);
    }
    updateModal();
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }
  function closeModal() {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }
  function step(dir) {
    if (!activeGallery) return;
    modalIndex = (modalIndex + dir + activeGallery.count) % activeGallery.count;
    updateModal();
  }

  modalPrev && modalPrev.addEventListener('click', () => step(-1));
  modalNext && modalNext.addEventListener('click', () => step(1));
  modalClose && modalClose.addEventListener('click', closeModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', e => {
    if (!modal.classList.contains('open')) return;
    if (e.key === 'Escape')    closeModal();
    if (e.key === 'ArrowLeft')  step(-1);
    if (e.key === 'ArrowRight') step(1);
  });
  bindDrag(modalTrack, dir => step(dir), () => modalIndex);

  document.querySelectorAll('.eg-open').forEach(btn => {
    btn.addEventListener('click', () => {
      const card = btn.closest('.edition-card');
      const galleryEl = card ? card.querySelector('.ec-gallery[data-gallery]') : null;
      const gallery = galleries.find(g => g.el === galleryEl);
      if (gallery) openModal(gallery);
    });
  });
})();

/* ─── PARALLAX — scroll-driven depth on [data-parallax] elements ───────
   Each element gets a CSS var --py (its own vertical offset in px),
   which the element's own CSS composes into its transform. Keeping the
   offset in a var (rather than writing el.style.transform directly)
   means it never fights hover-zoom rules that also set transform. ── */
(function () {
  const items = Array.from(document.querySelectorAll('[data-parallax]')).map(el => ({
    el,
    speed: parseFloat(el.dataset.parallax) || 0.15,
  }));
  if (!items.length) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  let ticking = false;
  function update() {
    const viewportCenter = window.innerHeight / 2;
    items.forEach(({ el, speed }) => {
      const rect = el.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) return;
      const elCenter = rect.top + rect.height / 2;
      const offset = (viewportCenter - elCenter) * speed;
      el.style.setProperty('--py', `${offset.toFixed(1)}px`);
    });
    ticking = false;
  }
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  update();
})();
