(async function() {
  const loading = document.getElementById('benchmark-loading');
  const canvas = document.getElementById('benchmark-chart');
  const tableDiv = document.getElementById('benchmark-table');

  try {
    const resp = await fetch(
      'https://raw.githubusercontent.com/Atmosphere/atmosphere/benchmark-data/dev/bench/data.js'
    );
    if (!resp.ok) {
      loading.textContent = 'No benchmark data available yet — the first CI run will populate this page.';
      return;
    }

    const text = await resp.text();
    const fn = new Function(text + '; return window.BENCHMARK_DATA;');
    const data = fn();

    if (!data || !data.entries) {
      loading.textContent = 'Benchmark data format not recognized.';
      return;
    }

    const entries = data.entries['Atmosphere JMH Benchmarks'] || [];
    if (entries.length === 0) {
      loading.textContent = 'No benchmark entries found yet.';
      return;
    }

    const latest = entries[entries.length - 1];
    const benches = latest.benches || [];

    var html = '<table><thead><tr><th>Benchmark</th><th>Value</th><th>Unit</th><th>\u00b1Error</th></tr></thead><tbody>';
    for (var i = 0; i < benches.length; i++) {
      var b = benches[i];
      var name = b.name.replace(/^org\.atmosphere\.benchmarks\.jmh\./, '');
      html += '<tr><td><code>' + name + '</code></td><td><strong>' + b.value.toFixed(2) + '</strong></td><td>' + b.unit + '</td><td>\u00b1' + (b.range || '?') + '</td></tr>';
    }
    html += '</tbody></table>';
    var dateStr = new Date(latest.date * 1000).toISOString().split('T')[0];
    var commitId = (latest.commit && latest.commit.id) ? latest.commit.id.slice(0, 8) : '?';
    html += '<p style="margin-top:0.5em;font-size:0.85em;color:#666;">Run: ' + dateStr + ' \u00b7 Commit: <code>' + commitId + '</code></p>';

    tableDiv.innerHTML = html;
    tableDiv.style.display = 'block';
    loading.style.display = 'none';

    if (entries.length > 1 && typeof Chart !== 'undefined') {
      var recentEntries = entries.slice(-20);
      var labels = recentEntries.map(function(e) { return new Date(e.date * 1000).toLocaleDateString(); });
      var benchNames = [];
      recentEntries.forEach(function(e) {
        (e.benches || []).forEach(function(b) {
          if (benchNames.indexOf(b.name) === -1) benchNames.push(b.name);
        });
      });

      var colors = ['#2563eb','#dc2626','#16a34a','#ca8a04','#9333ea','#0891b2','#e11d48','#4f46e5'];
      var datasets = benchNames.map(function(name, i) {
        return {
          label: name.replace(/^org\.atmosphere\.benchmarks\.jmh\./, ''),
          data: recentEntries.map(function(e) {
            var found = (e.benches || []).find(function(x) { return x.name === name; });
            return found ? found.value : null;
          }),
          borderColor: colors[i % colors.length],
          tension: 0.3,
          fill: false,
        };
      });

      canvas.style.display = 'block';
      new Chart(canvas, {
        type: 'line',
        data: { labels: labels, datasets: datasets },
        options: {
          responsive: true,
          plugins: {
            legend: { position: 'bottom', labels: { font: { size: 11 } } },
            title: { display: true, text: 'Benchmark History (last 20 runs)' },
          },
          scales: { y: { beginAtZero: false } },
        },
      });
    }
  } catch (err) {
    loading.textContent = 'Could not load benchmark data: ' + err.message;
  }
})();
