import type { OutputBundle, OutputChunk } from 'rollup';
import type { Plugin as VitePlugin } from 'vite';
import type { BuildInternals } from './internal.js';
import type { AstroAdapter } from '../../@types/astro';
import type { StaticBuildOptions } from './types';
import type { SerializedRouteInfo, SerializedSSRManifest } from '../app/types';

import { chunkIsPage, rootRelativeFacadeId, getByFacadeId } from './generate.js';
import { serializeRouteData } from '../routing/index.js';
import { getPageDataByComponent, eachPageData } from './internal.js';
import { addRollupInput } from './add-rollup-input.js';
import { virtualModuleId as pagesVirtualModuleId } from './vite-plugin-pages.js';

export const virtualModuleId = '@astrojs-ssr-virtual-entry';
const resolvedVirtualModuleId = '\0' + virtualModuleId;
const manifestReplace = '@@ASTRO_MANIFEST_REPLACE@@';

export function vitePluginSSR(buildOpts: StaticBuildOptions, internals: BuildInternals, adapter: AstroAdapter): VitePlugin {
	return {
		name: '@astrojs/vite-plugin-astro-ssr',
		options(opts) {
			return addRollupInput(opts, [virtualModuleId]);
		},
		resolveId(id) {
			if (id === virtualModuleId) {
				return resolvedVirtualModuleId;
			}
		},
		load(id) {
			if (id === resolvedVirtualModuleId) {
				return `import * as adapter from '${adapter.serverEntrypoint}';
import * as _main from '${pagesVirtualModuleId}';
import { deserializeManifest as _deserializeManifest } from 'astro/app';
const _manifest = Object.assign(_deserializeManifest('${manifestReplace}'), {
	pageMap: _main.pageMap,
	renderers: _main.renderers
});

${
	adapter.exports
		? `const _exports = adapter.createExports(_manifest);
${adapter.exports.map((name) => `export const ${name} = _exports['${name}'];`).join('\n')}
`
		: ''
}
const _start = 'start';
if(_start in adapter) {
	adapter[_start](_manifest);
}`;
			}
			return void 0;
		},

		generateBundle(opts, bundle) {
			const manifest = buildManifest(buildOpts, internals);
			
			for(const [_chunkName, chunk] of Object.entries(bundle)) {
				if(chunk.type === 'asset') continue;
				if(chunk.modules[resolvedVirtualModuleId]) {
					const exp = new RegExp(`['"]${manifestReplace}['"]`);
					const code = chunk.code;
					chunk.code = code.replace(exp, () => {
						return JSON.stringify(manifest);
					});
				}
			}
		},
	};
}

function buildManifest(opts: StaticBuildOptions, internals: BuildInternals): SerializedSSRManifest {
	const { astroConfig } = opts;

	const routes: SerializedRouteInfo[] = [];

	for(const pageData of eachPageData(internals)) {
		const scripts = Array.from(pageData.scripts);
		if(pageData.hoistedScript) {
			scripts.unshift(pageData.hoistedScript);
		}

		routes.push({
			file: '',
			links: Array.from(pageData.css),
			scripts,
			routeData: serializeRouteData(pageData.route),
		});
	}

	// HACK! Patch this special one.
	const entryModules = Object.fromEntries(internals.entrySpecifierToBundleMap.entries());
	entryModules['astro:scripts/before-hydration.js'] = 'data:text/javascript;charset=utf-8,//[no before-hydration script]';

	const ssrManifest: SerializedSSRManifest = {
		routes,
		site: astroConfig.buildOptions.site,
		markdown: {
			render: astroConfig.markdownOptions.render,
		},
		pageMap: null as any,
		renderers: [],
		entryModules,
	};

	return ssrManifest;
}