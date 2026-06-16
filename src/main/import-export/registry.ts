import { ImporterFactory } from './importer';
import { createKeePassXmlImporter } from './parsers/keepassXmlParser';
import { createBitwardenJsonImporter } from './parsers/bitwardenJsonParser';
import { createOnePasswordCsvImporter } from './parsers/onePasswordCsvParser';
import { createGenericCsvImporter } from './parsers/genericCsvParser';
import { createEncryptedJsonImporter } from './parsers/encryptedJsonParser';
import type { ImportFormat, CsvColumnMapping } from '../../shared/types';

export function createDefaultImporterFactory(): ImporterFactory {
  const factory = new ImporterFactory();
  factory.register('keepass-xml', () => createKeePassXmlImporter());
  return factory;
}

export function createImporterFactoryWithAllDefaults(): ImporterFactory {
  const factory = new ImporterFactory();
  factory.register('keepass-xml', () => createKeePassXmlImporter());
  factory.register('bitwarden-json', () => createBitwardenJsonImporter());
  factory.register('1password-csv', () => createOnePasswordCsvImporter());
  factory.register('generic-csv', () => createGenericCsvImporter());
  factory.register('encrypted-json', () => createEncryptedJsonImporter());
  return factory;
}

export function createGenericCsvImporterWithMapping(
  mapping: CsvColumnMapping,
): ReturnType<typeof createGenericCsvImporter> {
  return createGenericCsvImporter(mapping);
}
