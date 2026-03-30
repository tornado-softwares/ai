/**
 * Transform a JSON schema to be compatible with OpenAI's structured output requirements.
 * OpenAI requires:
 * - All properties must be in the `required` array
 * - Optional fields should have null added to their type union
 * - additionalProperties must be false for objects
 *
 * @param schema - JSON schema to transform
 * @param originalRequired - Original required array (to know which fields were optional)
 * @returns Transformed schema compatible with OpenAI structured output
 */
export function makeStructuredOutputCompatible(
  schema: Record<string, any>,
  originalRequired: Array<string> = [],
): Record<string, any> {
  const result = { ...schema }

  if (result.type === 'object' && result.properties) {
    const properties = { ...result.properties }
    const allPropertyNames = Object.keys(properties)

    for (const propName of allPropertyNames) {
      const prop = properties[propName]
      const wasOptional = !originalRequired.includes(propName)

      if (prop.type === 'object' && prop.properties) {
        properties[propName] = makeStructuredOutputCompatible(
          prop,
          prop.required || [],
        )
      } else if (prop.type === 'array' && prop.items) {
        properties[propName] = {
          ...prop,
          items: makeStructuredOutputCompatible(
            prop.items,
            prop.items.required || [],
          ),
        }
      } else if (prop.anyOf) {
        properties[propName] = makeStructuredOutputCompatible(
          prop,
          prop.required || [],
        )
      } else if (prop.oneOf) {
        throw new Error(
          'oneOf is not supported in OpenAI structured output schemas. Check the supported outputs here: https://platform.openai.com/docs/guides/structured-outputs#supported-types',
        )
      } else if (wasOptional) {
        // Optional fields must be nullable because OpenAI requires all properties in `required`
        if (prop.type && !Array.isArray(prop.type)) {
          properties[propName] = {
            ...prop,
            type: [prop.type, 'null'],
          }
        } else if (Array.isArray(prop.type) && !prop.type.includes('null')) {
          properties[propName] = {
            ...prop,
            type: [...prop.type, 'null'],
          }
        }
      }
    }

    result.properties = properties
    result.required = allPropertyNames
    result.additionalProperties = false
  }

  if (result.type === 'array' && result.items) {
    result.items = makeStructuredOutputCompatible(
      result.items,
      result.items.required || [],
    )
  }

  if (result.anyOf && Array.isArray(result.anyOf)) {
    result.anyOf = result.anyOf.map((variant) =>
      makeStructuredOutputCompatible(variant, variant.required || []),
    )
  }

  if (result.oneOf) {
    throw new Error(
      'oneOf is not supported in OpenAI structured output schemas. Check the supported outputs here: https://platform.openai.com/docs/guides/structured-outputs#supported-types',
    )
  }

  return result
}
