import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { seed, applyAction } from '../server/domain.mjs';

test('UV tiers, pack remainders, NFC included delivery and next-order eligibility agree in browser and server', async () => {
  const source = fs.readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
  const context = vm.createContext({ Intl, document: { querySelectorAll: () => [] } });
  vm.runInContext(source.slice(0, source.indexOf('let liveCatalog')), context);
  for (const [id, quantity, amount] of [
    ['uv-smart', 1, 200], ['uv-smart', 2, 300], ['uv-smart', 3, 350],
    ['uv-smart', 4, 500], ['uv-smart', 5, 600], ['uv-smart', 6, 750],
    ['uv-smart', 10, 1200], ['premium-nfc', 1, 400], ['premium-nfc', 2, 800],
  ]) {
    const state = { ...structuredClone(seed), orders: [] };
    const items = [{ productId: id, quantity }];
    const response = await applyAction(state, '/api/order-request', {
      method: 'POST', body: JSON.stringify({ items, zone: 'outside', requestId: `${id}-${quantity}` }),
    });
    const output = await response.json();
    assert.equal(output.result.amount, amount);
    assert.equal(output.state.orders[0].nextUvDiscountPercent, quantity >= 5 ? 10 : 0);
    context.items = items; context.data = state;
    assert.equal(vm.runInContext('calculateTotals(items, data, "outside").amount', context), amount);
  }
});
