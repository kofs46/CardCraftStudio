import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
test("browser shopping list persists variant lines and uses server catalog prices in estimates", () => {
  const source = fs.readFileSync(
    new URL("../js/main.js", import.meta.url),
    "utf8",
  );
  const saved = new Map();
  const context = {
    Intl,
    structuredClone,
    localStorage: {
      getItem: (key) => saved.get(key) || null,
      setItem: (key, value) => saved.set(key, value),
    },
    document: { querySelectorAll: () => [] },
  };
  vm.createContext(context);
  vm.runInContext(source.slice(0, source.indexOf("let liveCatalog")), context);
  const result = vm.runInContext(
    `(()=>{
 const products=[{id:'bike-keyring',customization:'bike-keyring',available:true,price:250,doublePrice:300}];
 saveCart([{productId:'bike-keyring',quantity:1,printSides:1},{productId:'bike-keyring',quantity:2,printSides:2}]);
 const lines=readCart(products);
 return {lines,total:calculateTotals(lines,{products,combos:[],settings:{deliveryEnabled:true,dhakaFee:50,outsideFee:100,freeThreshold:5}},'dhaka')};
 })()`,
    context,
  );
  assert.equal(result.lines.length, 2);
  assert.equal(result.total.amount, 850);
  assert.equal(result.total.quantity, 3);
  assert.ok(!source.includes("pvc_shop_frontend_v1"));
  assert.ok(source.includes('credentials:"same-origin"'));
  assert.ok(source.includes('name="password"'));
});
