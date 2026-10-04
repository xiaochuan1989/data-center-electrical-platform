// Only pinned third-party distribution resources; never scan business folders.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const pins={mammoth:'1.13.0','pdfjs-dist':'6.3.289',xlsx:'0.20.3','xlsx-js-style':'1.2.0'};
export function localParserAssets() {
  const files=new Map(),versions={};
  const roots=Object.fromEntries(Object.entries(pins).map(([name,version])=>{
    let directory=path.dirname(require.resolve(name)),pkg;
    while(true) {
      const candidate=path.join(directory,'package.json');
      if(fs.existsSync(candidate) && JSON.parse(fs.readFileSync(candidate,'utf8')).name===name) {pkg=candidate;break;}
      const parent=path.dirname(directory);if(parent===directory) throw new Error(`Package root not found: ${name}`);directory=parent;
    }
    const actual=JSON.parse(fs.readFileSync(pkg,'utf8')).version;
    if(actual!==version) throw new Error(`Local parser ${name}: expected ${version}, got ${actual}`);
    versions[name]=actual;return [name,path.dirname(pkg)];
  }));
  function add(name,relative,target) {
    const filename=path.join(roots[name],relative);
    let bytes=fs.readFileSync(filename);
    if(/\.(?:js|mjs)$/.test(relative)) bytes=Buffer.from(bytes.toString('utf8').replace(/^\/\/# sourceMappingURL=.*$/gm,''));
    if(files.has(target)) throw new Error(`Duplicate parser asset: ${target}`);
    files.set(target,bytes);
  }
  add('mammoth','mammoth.browser.min.js','vendor/mammoth/mammoth.browser.min.js');
  add('xlsx','dist/xlsx.full.min.js','vendor/xlsx/reader.min.js');
  add('xlsx-js-style','dist/xlsx.bundle.js','vendor/xlsx/style-writer.min.js');
  add('pdfjs-dist','legacy/build/pdf.mjs','vendor/pdfjs/pdf.mjs');
  add('pdfjs-dist','legacy/build/pdf.worker.mjs','vendor/pdfjs/pdf.worker.mjs');
  for(const folder of ['cmaps','standard_fonts','wasm']) {
    for(const entry of fs.readdirSync(path.join(roots['pdfjs-dist'],folder),{withFileTypes:true})) {
      if(entry.isFile() && /\.(bcmap|ttf|pfb|wasm|js|mjs)$/.test(entry.name)) add('pdfjs-dist',`${folder}/${entry.name}`,`vendor/pdfjs/${folder}/${entry.name}`);
      else if(entry.isFile() && /LICENSE/i.test(entry.name)) add('pdfjs-dist',`${folder}/${entry.name}`,`vendor/pdfjs/${folder}/${entry.name}`);
    }
  }
  for(const name of Object.keys(pins)) {
    const licenses=fs.readdirSync(roots[name]).filter(v=>/^LICENSE(?:\.txt|\.md)?$/i.test(v));
    if(!licenses.length) throw new Error(`Missing license for ${name}`);
    for(const file of licenses) add(name,file,`vendor/licenses/${name}-${file}`);
  }
  const assets=[...files].map(([file,bytes])=>({file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}));
  files.set('vendor/parser-manifest.json',Buffer.from(JSON.stringify({version:1,versions,assets},null,2)));
  return files;
}
export function localParserPlugin() {
  let files;
  const inventory=()=>files||(files=localParserAssets());
  return {name:'same-origin-local-parsers',
    buildStart(){ inventory(); },
    generateBundle(){ for(const [fileName,source] of inventory()) this.emitFile({type:'asset',fileName,source}); },
    configureServer(server){
      server.middlewares.use((req,res,next)=>{
        let target;try {target=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\//,'');} catch {return next();}
        if(!target.startsWith('vendor/')) return next();
        const bytes=inventory().get(target);
        if(!bytes) {res.statusCode=404;res.end('Local parser resource not found');return;}
        res.setHeader('Content-Type',/\.(js|mjs)$/.test(target)?'application/javascript':target.endsWith('.json')?'application/json':target.endsWith('.wasm')?'application/wasm':'application/octet-stream');
        res.setHeader('Content-Length',bytes.length);res.end(bytes);
      });
    }
  };
}
