import { type ZodErrorMap, ZodIssueCode, ZodParsedType } from 'zod';

const TYPE_ES: Record<string, string> = {
  string: 'texto',
  number: 'numero',
  boolean: 'verdadero/falso',
  array: 'lista',
  object: 'objeto',
  date: 'fecha',
  integer: 'entero',
};

const FORMAT_ES: Record<string, string> = {
  email: 'Correo electronico invalido',
  url: 'URL invalida',
  uuid: 'Identificador invalido',
  datetime: 'Fecha y hora invalidas (use formato ISO 8601)',
  date: 'Fecha invalida',
  time: 'Hora invalida',
  regex: 'Formato invalido',
};

/** Mapa de errores de zod en espanol (Colombia). */
export const esErrorMap: ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === ZodParsedType.undefined || issue.received === ZodParsedType.null) return { message: 'Este campo es obligatorio' };
      return { message: `Se esperaba ${TYPE_ES[issue.expected] ?? issue.expected} y se recibio ${TYPE_ES[issue.received] ?? issue.received}` };
    case ZodIssueCode.invalid_literal:
      return { message: 'Valor no permitido' };
    case ZodIssueCode.unrecognized_keys:
      return { message: `Campos no reconocidos: ${issue.keys.join(', ')}` };
    case ZodIssueCode.invalid_union:
    case ZodIssueCode.invalid_union_discriminator:
      return { message: 'Valor invalido' };
    case ZodIssueCode.invalid_enum_value:
      return { message: `Valor no permitido. Opciones: ${issue.options.join(', ')}` };
    case ZodIssueCode.invalid_string:
      if (typeof issue.validation === 'string') return { message: FORMAT_ES[issue.validation] ?? 'Texto invalido' };
      if ('startsWith' in issue.validation) return { message: `Debe comenzar con "${issue.validation.startsWith}"` };
      if ('endsWith' in issue.validation) return { message: `Debe terminar con "${issue.validation.endsWith}"` };
      return { message: 'Texto invalido' };
    case ZodIssueCode.too_small: {
      const n = String(issue.minimum);
      if (issue.type === 'string') return { message: issue.minimum === 1 ? 'Este campo no puede estar vacio' : `Debe tener al menos ${n} caracteres` };
      if (issue.type === 'array') return { message: `Debe incluir al menos ${n} elemento(s)` };
      return { message: `Debe ser ${issue.inclusive ? 'mayor o igual a' : 'mayor que'} ${n}` };
    }
    case ZodIssueCode.too_big: {
      const n = String(issue.maximum);
      if (issue.type === 'string') return { message: `Debe tener maximo ${n} caracteres` };
      if (issue.type === 'array') return { message: `Debe incluir maximo ${n} elemento(s)` };
      return { message: `Debe ser ${issue.inclusive ? 'menor o igual a' : 'menor que'} ${n}` };
    }
    case ZodIssueCode.not_multiple_of:
      return { message: `Debe ser multiplo de ${String(issue.multipleOf)}` };
    case ZodIssueCode.invalid_date:
      return { message: 'Fecha invalida' };
    default:
      return { message: ctx.defaultError };
  }
};
