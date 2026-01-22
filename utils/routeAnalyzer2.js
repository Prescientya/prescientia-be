/**
 * Route Analyzer - Extract all endpoints from registered routes using config
 */

function extractEndpointsFromRouter(router) {
  const endpoints = [];
  
  if (!router.stack) return endpoints;
  
  router.stack.forEach(layer => {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods).map(m => m.toUpperCase());
      methods.forEach(method => {
        endpoints.push({
          method,
          path: layer.route.path || '/'
        });
      });
    }
  });
  
  return endpoints;
}

function displayRoutes(app, routesConfig) {
  console.log('\n📋 Available Endpoints:\n');
  
  // Root routes
  const rootEndpoints = [];
  
  // Add root endpoints from app
  if (app._router && app._router.stack) {
    app._router.stack.forEach(layer => {
      if (layer.route && (layer.route.path === '/' || layer.route.path === undefined)) {
        const methods = Object.keys(layer.route.methods).map(m => m.toUpperCase());
        methods.forEach(method => {
          rootEndpoints.push({
            method,
            path: layer.route.path || '/'
          });
        });
      }
    });
  }

  // Display root endpoints
  if (rootEndpoints.length > 0) {
    const methodCounts = {};
    rootEndpoints.forEach(ep => {
      methodCounts[ep.method] = (methodCounts[ep.method] || 0) + 1;
    });

    const countStr = Object.entries(methodCounts)
      .sort()
      .map(([method, count]) => `${count}${method[0]}`)
      .join(' ');

    console.log(`🔹 Root (${countStr})`);
    console.log('───────────────────────────────────────────────────');

    const byMethod = {};
    rootEndpoints.forEach(ep => {
      if (!byMethod[ep.method]) byMethod[ep.method] = [];
      byMethod[ep.method].push(ep.path);
    });

    const methodOrder = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'];
    methodOrder.forEach(method => {
      if (byMethod[method]) {
        byMethod[method].forEach(path => {
          const icon = { GET: '🟢', POST: '🔵', PATCH: '🟡', PUT: '🟣', DELETE: '🔴' }[method];
          console.log(`  ${icon} ${method.padEnd(8)} ${path}`);
        });
      }
    });

    console.log('');
  }

  // Display API routes
  let totalCount = rootEndpoints.length;

  if (routesConfig && Array.isArray(routesConfig)) {
    routesConfig.forEach(routeConfig => {
      const endpoints = extractEndpointsFromRouter(routeConfig.handler);
      
      if (endpoints.length === 0) return;

      const methodCounts = {};
      endpoints.forEach(ep => {
        methodCounts[ep.method] = (methodCounts[ep.method] || 0) + 1;
      });

      const countStr = Object.entries(methodCounts)
        .sort()
        .map(([method, count]) => `${count}${method[0]}`)
        .join(' ');

      console.log(`🔹 ${routeConfig.path} (${countStr})`);
      console.log('───────────────────────────────────────────────────');

      const byMethod = {};
      endpoints.forEach(ep => {
        if (!byMethod[ep.method]) byMethod[ep.method] = [];
        byMethod[ep.method].push(ep.path);
      });

      const methodOrder = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'];
      methodOrder.forEach(method => {
        if (byMethod[method]) {
          byMethod[method].forEach(path => {
            const icon = { GET: '🟢', POST: '🔵', PATCH: '🟡', PUT: '🟣', DELETE: '🔴' }[method];
            console.log(`  ${icon} ${method.padEnd(8)} ${path}`);
            totalCount++;
          });
        }
      });

      console.log('');
    });
  }

  console.log('═══════════════════════════════════════════════════════');
  console.log(`📊 Total Endpoints: ${totalCount}`);
  console.log('═══════════════════════════════════════════════════════\n');

  return totalCount;
}

module.exports = {
  extractEndpointsFromRouter,
  displayRoutes
};
