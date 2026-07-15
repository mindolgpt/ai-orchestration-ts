const fs = require("fs");
const path = require("path");

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (e.name.endsWith(".js")) fixFile(full);
  }
}

function fixFile(file) {
  let code = fs.readFileSync(file, "utf-8");
  const orig = code;
  code = code.replace(/(from\s+['"])(\.\.?\/[^'"]+?)(['"])/g, (m, pre, p, suf) =>
    p.endsWith(".js") ? m : pre + p + ".js" + suf
  );
  code = code.replace(/(exports\.\w+\s*=\s*require\(['"])(\.\.?\/[^'"]+?)(['"])/g, (m, pre, p, suf) =>
    p.endsWith(".js") ? m : pre + p + ".js" + suf
  );
  if (code !== orig) fs.writeFileSync(file, code, "utf-8");
}

walk(path.resolve(process.argv[2] || "dist"));
