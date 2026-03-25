import { Converter, ReflectionKind, Renderer } from 'typedoc';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @param {import('typedoc-plugin-markdown').MarkdownApplication} app
 */
export function load(app) {
  app.converter.on(Converter.EVENT_RESOLVE_BEGIN, context => {
    // Convert accessors to properties
    context.project
      .getReflectionsByKind(ReflectionKind.Accessor)
      .forEach(accessor => {
        accessor.kind = ReflectionKind.Property;
        if (accessor.getSignature) {
          accessor.type = accessor.getSignature.type;
          accessor.comment = accessor.getSignature.comment;
        } else if (accessor.setSignature) {
          accessor.type = accessor.setSignature.parameters?.[0]?.type;
          accessor.comment = accessor.setSignature.comment;
        }
      });

    // Remove re-exports
    context.project
      .getReflectionsByKind(ReflectionKind.Reference)
      .forEach(ref => context.project.removeReflection(ref));

    // Merge `export=` namespaces into their parent
    context.project
      .getReflectionsByKind(ReflectionKind.Namespace)
      .filter(ref => ref.name === 'export=')
      .forEach(namespace =>
        context.project.mergeReflections(namespace, namespace.parent)
      );
  });

  app.renderer.on(Renderer.EVENT_END, event => {
    const router = app.renderer.router;
    const reflections = event.project
      .getReflectionsByKind(ReflectionKind.All)
      .filter(ref => {
        if (ref.name === 'export=' || ref.name === '__type') {
          return false;
        }
        if (ref.kind === ReflectionKind.Reference) {
          return false;
        }
        if (ref.isProject()) {
          return false;
        }
        return router.hasUrl(ref);
      });

    /** @type {Record<string, string>} */
    const typeMap = {};
    const shortNameKindMask =
      ReflectionKind.Class |
      ReflectionKind.Interface |
      ReflectionKind.TypeAlias |
      ReflectionKind.Enum;

    for (const ref of reflections) {
      const url = router.getAnchoredURL(ref).replace('export=/', '');
      const fullName = ref.getFullName();

      typeMap[fullName] = url;

      // Add short aliases for common type-like reflections to improve lookup
      // when markdown text references unqualified names like `Compiler`.
      if (ref.kindOf(shortNameKindMask) && !typeMap[ref.name]) {
        typeMap[ref.name] = url;
      }
    }

    writeFileSync(
      join(app.options.getValue('out'), 'type-map.json'),
      JSON.stringify(typeMap, null, 2)
    );
  });
}
