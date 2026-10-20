// Local protocol fixture for software verification; never a real AI extraction.
import http from 'node:http';
if (!process.argv.includes('--synthetic-fixture')) throw new Error('Explicit --synthetic-fixture is required');
const detail = (name, value, original_text) => ({ name, value, original_text, risk: 'LOW', evidence_status: 'VERIFIED', source_status: 'DOCUMENT' });
const server = http.createServer(async (req, res) => {
  const allowedOrigins=new Set(['http://127.0.0.1:5174','http://127.0.0.1:5175','http://localhost:5175']);
  if(allowedOrigins.has(req.headers.origin))res.setHeader('Access-Control-Allow-Origin',req.headers.origin);
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') { res.writeHead(404); res.end(); return; }
  let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 200000) { res.writeHead(413); res.end(); return; } }
  try {
    const data = JSON.parse(raw), input = JSON.parse(data.messages.find(m => m.role === 'user').content);
    if (input.file_name !== '合成AI规范验收.txt' || !input.document_text.includes('SYNTHETIC-SOFTWARE-QA')) { res.writeHead(422); res.end(); return; }
    if (data.model === 'synthetic-http-error') { res.writeHead(503); res.end(); return; }
    if (data.model === 'synthetic-delayed') await new Promise(resolve => setTimeout(resolve, 4000));
    if (input.task === 'review') {
      res.setHeader('Content-Type','application/json');
      const issues=data.model==='synthetic-review-issues'&&input.review_parameters.length
        ? [{kind:'OWNERSHIP',severity:'WARNING',parameter_id:input.review_parameters[0].parameter_id,message:'合成复核疑点：请核对该参数的设备归属。',original_text:input.review_parameters[0].detail.original_text}] : [];
      res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({complete:true,source_checked:true,checked_parameter_ids:input.review_parameters.map(p=>p.parameter_id),issues})}}]}));
      return;
    }
    const devices = [{ device_type: 'UPS主机', device_name: 'QA-UPS-A', scope: '', original_text: 'QA-UPS-A' }, { device_type: 'PDU', device_name: 'QA-PDU-B', scope: '', original_text: 'QA-PDU-B' }];
    const products = input.known_devices.map(d => ({ device_id: d.device_id, device_type: d.device_type, device_name: d.device_name,
      params_detail: d.device_name === 'QA-UPS-A' ? [detail('额定功率', '120kVA', 'QA-UPS-A额定功率为120kVA。'), detail('额定电流', '不低于200A', 'QA-UPS-A额定电流不低于200A。')]
        : [detail('输入电流', '32A', 'QA-PDU-B输入电流为32A。'), detail('插座数量', '12个', 'QA-PDU-B插座数量为12个。')]
    }));
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(input.task === 'discovery' ? { complete: true, devices } : { complete: true, products }) } }] }));
  } catch { res.writeHead(400); res.end(); }
});
server.listen(5194, '127.0.0.1', () => console.log('Synthetic-only protocol fixture listening on 127.0.0.1:5194'));
