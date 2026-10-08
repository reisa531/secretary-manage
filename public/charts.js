'use strict';
/**
 * 轻量图表库（纯 SVG，无外部依赖），用于团支部数字画像可视化。
 * 支持：饼图/环形图、垂直柱状图、水平条形图。
 */
(function (global) {
  const PALETTE = ['#c8102e', '#e8590c', '#f59f00', '#37b24d', '#0ca678', '#1971c2', '#7048e8', '#d6336c', '#12b886', '#495057', '#fab005', '#15aabf'];

  function color(i) {
    return PALETTE[i % PALETTE.length];
  }

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function renderPie(container, data, opts = {}) {
    const total = data.reduce((s, d) => s + d.value, 0) || 1;
    const size = opts.size || 220;
    const inner = opts.donut ? size * 0.32 : 0;
    const cx = size / 2, cy = size / 2, r = size / 2 - 4;
    let angle = -Math.PI / 2;
    const slices = data.map((d, i) => {
      const a = (d.value / total) * Math.PI * 2;
      const slice = { ...d, start: angle, end: angle + a, color: d.color || color(i) };
      angle += a;
      return slice;
    });

    let svg = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`;
    for (const s of slices) {
      const large = s.end - s.start > Math.PI ? 1 : 0;
      const x1 = cx + r * Math.cos(s.start), y1 = cy + r * Math.sin(s.start);
      const x2 = cx + r * Math.cos(s.end), y2 = cy + r * Math.sin(s.end);
      const d = `M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
      svg += `<path d="${d}" fill="${s.color}" stroke="#fff" stroke-width="1.5"><title>${esc(s.name)}: ${s.value} (${((s.value / total) * 100).toFixed(1)}%)</title></path>`;
    }
    if (inner > 0) {
      svg += `<circle cx="${cx}" cy="${cy}" r="${inner}" fill="#fff"/>`;
      svg += `<text x="${cx}" y="${cy + 5}" text-anchor="middle" font-size="14" fill="#444" font-weight="600">${opts.centerText || total}</text>`;
    }
    svg += '</svg>';

    const legend = `<div class="chart-legend">${slices.map((s) =>
      `<div class="legend-item"><span class="legend-dot" style="background:${s.color}"></span><span class="legend-name">${esc(s.name)}</span><span class="legend-val">${s.value} (${((s.value / total) * 100).toFixed(1)}%)</span></div>`
    ).join('')}</div>`;

    container.innerHTML = `<div class="pie-wrap">${svg}${legend}</div>`;
  }

  function renderBars(container, data, opts = {}) {
    const max = Math.max(...data.map((d) => d.value), 1);
    const height = opts.height || 220;
    const bw = opts.barWidth || 46;
    const gap = 14;
    const chartW = data.length * (bw + gap) + 40;
    const h = height;
    const base = h - 34;

    let svg = `<svg width="${Math.max(chartW, 320)}" height="${h}" viewBox="0 0 ${Math.max(chartW, 320)} ${h}">`;
    svg += `<line x1="30" y1="${base}" x2="${Math.max(chartW, 320) - 8}" y2="${base}" stroke="#e9ecef" stroke-width="1"/>`;
    data.forEach((d, i) => {
      const bh = Math.max((d.value / max) * (base - 24), d.value > 0 ? 3 : 0);
      const x = 40 + i * (bw + gap);
      const y = base - bh;
      const c = d.color || color(i);
      svg += `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="4" fill="${c}"><title>${esc(d.name)}: ${d.value}</title></rect>`;
      svg += `<text x="${x + bw / 2}" y="${y - 6}" text-anchor="middle" font-size="12" fill="#333" font-weight="600">${d.value}</text>`;
      svg += `<text x="${x + bw / 2}" y="${base + 16}" text-anchor="middle" font-size="11" fill="#666">${esc(shorten(d.name, 5))}</text>`;
    });
    svg += '</svg>';
    container.innerHTML = svg;
  }

  function renderHBars(container, data, opts = {}) {
    const max = Math.max(...data.map((d) => d.value), 1);
    const rowH = opts.rowHeight || 30;
    const h = data.length * rowH + 12;
    const labelW = opts.labelWidth || 110;
    const barMax = 360;
    let svg = `<svg width="100%" height="${h}" viewBox="0 0 ${labelW + barMax + 70} ${h}" preserveAspectRatio="xMinYMin meet">`;
    data.forEach((d, i) => {
      const y = i * rowH + 8;
      const w = (d.value / max) * barMax;
      const c = d.color || color(i);
      svg += `<text x="${labelW - 8}" y="${y + rowH / 2 + 4}" text-anchor="end" font-size="12" fill="#555">${esc(shorten(d.name, 8))}</text>`;
      svg += `<rect x="${labelW}" y="${y}" width="${Math.max(w, 2)}" height="${rowH - 10}" rx="4" fill="${c}"><title>${esc(d.name)}: ${d.value}</title></rect>`;
      svg += `<text x="${labelW + w + 6}" y="${y + rowH / 2 + 4}" font-size="12" fill="#333" font-weight="600">${d.value}</text>`;
    });
    svg += '</svg>';
    container.innerHTML = svg;
  }

  function shorten(s, n) {
    s = String(s ?? '');
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  global.ChartX = { renderPie, renderBars, renderHBars };
})(typeof window !== 'undefined' ? window : globalThis);
