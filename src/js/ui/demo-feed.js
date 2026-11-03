import { esc, STATUS_LABEL } from '../core/dom.js';
import { STATUSES } from '../data/unit-store.js';

/**
 * Demo only: simulates the client's unit status feed. In production the status
 * comes from units.json (or a CMS / sales API) and shows on reload with no redeploy.
 * Here, changes are stored in the browser and applied to the viewer at once.
 */
export class DemoFeed {
  constructor(el, { store }) {
    this.el = el;
    this.store = store;
    this.#render();
    this.#bind();
  }

  #render() {
    const meta = this.store.meta;
    this.el.innerHTML = `
      <span class="demo-feed__badge">Demo tool</span>
      <h2 class="display demo-feed__title" id="feed-title">Simulate the sales feed</h2>
      <p class="demo-feed__text">Statuses in this build are sample data (feed source: <strong>${esc(meta.source ?? 'demo')}</strong>).
        Change a residence's status here and any open Check Availability tab updates at once: floor cards, counts and the residence's colour. Changes are kept in this browser until you reset them.</p>
      <form class="demo-feed__form" data-feed-form novalidate>
        <div class="field">
          <label for="feed-unit">Residence reference</label>
          <input class="input" id="feed-unit" name="unit" list="feed-units" placeholder="A-25-U07" autocomplete="off" required
            pattern="[ABab]-\\d{2}-[Uu]\\d{2}" style="text-transform:uppercase">
          <datalist id="feed-units">${this.store.units.map((u) => `<option value="${u.id}">`).join('')}</datalist>
          <span class="field__error" data-error aria-live="polite"></span>
        </div>
        <div class="field">
          <label for="feed-status">New status</label>
          <select class="select" id="feed-status" name="status">
            ${STATUSES.map((s) => `<option value="${s}">${STATUS_LABEL[s]}</option>`).join('')}
          </select>
          <span class="field__error"></span>
        </div>
        <div class="field">
          <button class="btn btn--primary" type="submit">Update status</button>
          <span class="field__error"></span>
        </div>
        <div class="field">
          <button class="btn btn--secondary" type="button" data-reset>Reset demo data</button>
          <span class="field__error"></span>
        </div>
      </form>
      <p class="demo-feed__log" data-log aria-live="polite">${this.#overrideText()}</p>`;
  }

  #overrideText() {
    const n = this.store.overrideCount;
    return n ? `${n} status change${n === 1 ? '' : 's'} applied from the simulated feed.` : '';
  }

  #bind() {
    const form = this.el.querySelector('[data-feed-form]');
    const input = form.elements.unit;
    const error = form.querySelector('[data-error]');
    const log = this.el.querySelector('[data-log]');
    const field = input.closest('.field');

    const validate = () => {
      const id = input.value.trim().toUpperCase();
      let msg = '';
      if (!id) msg = 'Enter a residence reference, for example A-25-U07.';
      else if (!this.store.get(id)) msg = `No residence ${id}. References look like A-25-U07 (tower, floor, unit).`;
      error.textContent = msg;
      field.classList.toggle('has-error', Boolean(msg));
      input.setAttribute('aria-invalid', String(Boolean(msg)));
      return msg ? null : id;
    };
    input.addEventListener('blur', () => { if (input.value) validate(); });
    input.addEventListener('input', () => { if (field.classList.contains('has-error')) validate(); });
    input.addEventListener('change', () => {
      const u = this.store.get(input.value.trim().toUpperCase());
      if (u) form.elements.status.value = u.status;
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const id = validate();
      if (!id) { input.focus(); return; }
      const status = form.elements.status.value;
      this.store.setStatus(id, status);
      log.textContent = `${id} is now ${STATUS_LABEL[status]}. The viewer has updated. ${this.#overrideText()}`;
    });
    this.el.querySelector('[data-reset]').addEventListener('click', () => {
      this.store.resetStatuses();
      log.textContent = 'Demo statuses restored from units.json.';
    });
  }
}
