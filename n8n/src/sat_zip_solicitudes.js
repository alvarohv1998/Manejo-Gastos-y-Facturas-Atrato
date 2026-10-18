// Una llamada por cada descarga anterior del SAT cuyo ZIP de XML se va a pedir a Todo Conta.
const { zips } = $('SAT: preparar').first().json;
return (zips || []).length ? zips.map(llamada => ({ json: { llamada } })) : [{ json: { ninguna: true } }];
