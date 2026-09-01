import {
  AcDbDatabaseConverterManager,
  AcDbFileType,
} from '@mlightcad/data-model'
import { AcDbLibreDwgConverter } from '@mlightcad/libredwg-converter'

export function registerLibreDwgConverter() {
  const converter = new AcDbLibreDwgConverter({
    convertByEntityType: false,
    useWorker: true,
    parserWorkerUrl: new URL('./assets/libredwg-parser-worker.js', document.baseURI).href,
  })
  AcDbDatabaseConverterManager.instance.register(AcDbFileType.DWG, converter)
}
