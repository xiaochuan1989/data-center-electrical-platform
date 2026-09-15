import './css/platform-v2.css';
import { initializePlatform } from './platform/app-shell.js';
import { calculateLithiumBatteryA00 } from './modules/engineering-calculators.js';

window.calculateLithiumBatteryA00 = calculateLithiumBatteryA00;

function start() {
  initializePlatform().catch(error => {
    console.error('平台初始化失败', error);
    window.showToast?.(`新版平台外壳加载失败，已保留原有 UPS 功能：${error.message}`);
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
