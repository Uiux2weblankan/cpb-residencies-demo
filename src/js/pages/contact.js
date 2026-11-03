import { CONFIG } from '../config.js';
import { $, esc, TYPE_LONG, formatArea } from '../core/dom.js';
import { UnitStore } from '../data/unit-store.js';
import { initSiteMenu } from '../ui/site-menu.js';

/**
 * 13.0 Contact (demo). Prefills the residence from ?unit= (More Info / Contact Us
 * links in the viewer), validates on blur, and simulates sending: enquiries are
 * kept in localStorage only.
 */
initSiteMenu();

const form = $('[data-contact-form]');
const params = new URLSearchParams(location.search);
const unitId = (params.get('unit') || '').toUpperCase();
let store = null;

if (params.get('intent') === 'booking') {
  form.elements.interest.value = 'booking';
  $('[data-contact-title]').textContent = 'Plan Your Booking';
  $('[data-contact-lead]').textContent = 'Book a private visit to the sales gallery and a walk through both towers.';
}

const floorParam = Number(params.get('floor'));
const towerParam = (params.get('tower') || '').toUpperCase();
if (floorParam && /^[AB]$/.test(towerParam)) {
  form.elements.interest.value = 'residence';
  form.elements.message.value = `I'm interested in residences on floor ${floorParam} of Tower ${towerParam}.`;
  $('[data-contact-lead]').innerHTML = `You are enquiring about <strong>floor ${floorParam} of Tower ${esc(towerParam)}</strong>. Our sales team will share what is available.`;
}

new UnitStore().load(CONFIG.unitsUrl).then((s) => {
  store = s;
  const u = store.get(unitId);
  if (!u) return;
  form.elements.unit.value = u.id;
  form.elements.interest.value = 'residence';
  $('[data-contact-lead]').innerHTML = `You are enquiring about <strong>${esc(u.id)}</strong>: a ${TYPE_LONG[u.type].toLowerCase()} residence of ${formatArea(u.area_ft2)} on floor ${u.floor} of Tower ${esc(u.tower)}.`;
}).catch(() => { /* the form still works without unit data */ });

const RULES = {
  name: (v) => (v.trim().length >= 2 ? '' : 'Enter your full name.'),
  phone: (v) => (/^[+()\d\s-]{7,}$/.test(v.trim()) ? '' : 'Enter a phone number we can call, for example +94 77 123 4567.'),
  email: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? '' : 'Enter an email address like name@example.com.'),
  unit: (v) => {
    const id = v.trim().toUpperCase();
    if (!id) return '';
    if (!/^[AB]-\d{2}-U\d{2}$/.test(id)) return 'References look like A-25-U07 (tower, floor, unit).';
    if (store && !store.get(id)) return `There is no residence ${id}. Check the reference, or leave it empty.`;
    return '';
  },
  consent: (_, el) => (el.checked ? '' : 'Tick the box so our team can contact you.'),
};

function check(el) {
  const rule = RULES[el.name];
  if (!rule) return true;
  const msg = rule(el.value, el);
  const field = el.closest('.field');
  field.classList.toggle('has-error', Boolean(msg));
  field.querySelector('.field__error').textContent = msg;
  el.setAttribute('aria-invalid', String(Boolean(msg)));
  return !msg;
}

// Validate on blur; once a field shows an error, re-check as the user types.
form.addEventListener('focusout', (e) => { if (e.target.name in RULES && e.target.value !== '') check(e.target); });
form.addEventListener('input', (e) => { if (e.target.closest('.field')?.classList.contains('has-error')) check(e.target); });
form.addEventListener('change', (e) => { if (e.target.type === 'checkbox') check(e.target); });

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const fields = Object.keys(RULES).map((n) => form.elements[n]);
  const invalid = fields.filter((el) => !check(el));
  if (invalid.length) { invalid[0].focus(); return; }

  const data = Object.fromEntries(new FormData(form));
  const saved = JSON.parse(localStorage.getItem('cpb-demo-enquiries') || '[]');
  saved.push({ ...data, unit: data.unit.toUpperCase(), at: new Date().toISOString() });
  localStorage.setItem('cpb-demo-enquiries', JSON.stringify(saved));

  const panel = $('[data-form-panel]');
  panel.innerHTML = `
    <div class="form-success" role="status" tabindex="-1">
      <h2 class="display form-success__title">Thank you, ${esc(data.name.trim().split(' ')[0])}</h2>
      <p>Our sales team will contact you within one working day${data.unit ? ` about ${esc(data.unit.toUpperCase())}` : ''}.</p>
      <p style="margin-top:8px;color:var(--gray-500);font-size:14px">Demo build: the enquiry was saved in this browser only.</p>
      <p style="margin-top:24px"><a class="btn btn--secondary" href="index.html"><span class="btn__dot" aria-hidden="true"></span>Back to the residences</a></p>
    </div>`;
  panel.querySelector('.form-success').focus();
});
