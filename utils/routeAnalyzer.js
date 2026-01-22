/**
 * Route Analyzer - Dynamically extract endpoints from Express routers
 * Supports nested routes and parameterized paths
 */

function getAllRoutes(app) {
  const routes = [];

  // Traverse the app's router stack
  if (app._router && app._router.stack) {
    app._router.stack.forEach(middleware => {
      // Check if it's a route
      if (middleware.route) {
        const path = middleware.route.path;
        const methods = Object.keys(middleware.route.methods);
        
        methods.forEach(method => {
          routes.push({
            method: method.toUpperCase(),
            path: path,
            fullPath: path
          });
        });
      }
      // Check if it's a router middleware
      else if (middleware.name === 'router' && middleware.handle.stack) {
        // Get the mount path from the regexp
        let mountPath = '';
        try {
          const regexpStr = middleware.regexp.source;
          const match = regexpStr.match(/^\\\/(.+?)(?:\\|$)/);
          if (match) {
            mountPath = '/' + match[1];
          } else if (regexpStr.includes('api')) {
            // Fallback: extract from regexp for /api paths
            const parts = regexpStr.split('\\');
            for (let i = 0; i < parts.length; i++) {
              if (parts[i] === 'api' && parts[i + 1]) {
                mountPath = '/' + parts[i] + '/' + parts[i + 1];
                break;
              }
            }
          }
        } catch (e) {
          // Ignore errors in regexp parsing
        }

        // Traverse sub-routes
        middleware.handle.stack.forEach(subMiddleware => {
          if (subMiddleware.route) {
            const path = subMiddleware.route.path;
            const methods = Object.keys(subMiddleware.route.methods);
            
            methods.forEach(method => {
              routes.push({
                method: method.toUpperCase(),
                path: path || '/',
                parentPath: mountPath,
                fullPath: mountPath + (path || '/')
              });
            });
          }
        });
      }
    });
  }

  return routes;
}

/**
 * Format routes for console output with proper grouping
 */
function formatRoutesForDisplay(routes) {
  if (!Array.isArray(routes)) {
    return {};
  }

  const groupedRoutes = {};

  routes.forEach(route => {
    const parentPath = route.parentPath || 'Root';
    
    if (!groupedRoutes[parentPath]) {
      groupedRoutes[parentPath] = [];
    }

    groupedRoutes[parentPath].push({
      method: route.method,
      path: route.path || '/',
      fullPath: route.fullPath || route.path || '/',
    });
  });

  return groupedRoutes;
}

/**
 * Pretty print routes to console
 */
function displayRoutes(app) {
  const routes = getAllRoutes(app);
  const groupedRoutes = formatRoutesForDisplay(routes);
  let totalCount = 0;

  console.log('\n📋 Available Endpoints by Route:\n');

  // Sort and display by route group
  const sortedGroups = Object.entries(groupedRoutes).sort();
  
  sortedGroups.forEach(([parentPath, endpoints]) => {
    const methodCounts = {};
    endpoints.forEach(ep => {
      methodCounts[ep.method] = (methodCounts[ep.method] || 0) + 1;
    });

    const countStr = Object.entries(methodCounts)
      .map(([method, count]) => `${count} ${method}`)
      .join(', ');

    console.log(`🔹 ${parentPath} (${countStr})`);
    console.log('───────────────────────────────────────────────────');

    // Group by HTTP method for better readability
    const byMethod = {};
    endpoints.forEach(ep => {
      if (!byMethod[ep.method]) byMethod[ep.method] = [];
      byMethod[ep.method].push(ep.path || '/');
    });

    // Display in order: GET, POST, PATCH, PUT, DELETE
    const methodOrder = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'];
    
    methodOrder.forEach(method => {
      if (byMethod[method]) {
        byMethod[method].forEach(path => {
          const methodColor = {
            GET: '🟢',
            POST: '🔵',
            PATCH: '🟡',
            PUT: '🟣',
            DELETE: '🔴'
          }[method] || '⚫';

          console.log(`  ${methodColor} ${method.padEnd(8)} ${path}`);
          totalCount++;
        });
      }
    });

    console.log('');
  });

  console.log('═══════════════════════════════════════════════════════');
  console.log(`📊 Total Endpoints: ${totalCount}`);
  console.log('═══════════════════════════════════════════════════════\n');

  return totalCount;
}

module.exports = {
  getAllRoutes,
  formatRoutesForDisplay,
  displayRoutes
};
