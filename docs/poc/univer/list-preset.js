fetch('https://unpkg.com/@univerjs/preset-docs-core@1.5.2/?meta')
  .then(r => r.json())
  .then(j => {
    const files = [];
    (function walk(n, p) {
      if (n.files) n.files.forEach(f => walk(f, p + '/' + f.name));
      else files.push(p + ' ' + n.size);
    })(j);
    console.log(files.join('\n'));
  })
  .catch(e => console.log('ERR', e.message));
