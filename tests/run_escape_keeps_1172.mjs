// Native node:test registration/output in this one supervised Node process.
// No discovery subprocess or hidden inventory/fixture successor.
if(!['red','green'].includes(process.argv[2]))throw Error('Choose red or green');
process.env.ESCAPE1172_PHASE=process.argv[2];
await import('./ui_escape_keeps_1172.test.mjs');
