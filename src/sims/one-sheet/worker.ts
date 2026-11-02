/// <reference lib="webworker" />
import * as Comlink from 'comlink'
import { expanded, heightField, type HeightField } from './model'
import { OneSheetConfig } from './schema'

const api = {
  /** Height field at a scale factor and pooled fraction; the arrays are transferred, not copied. */
  field(rawConfig: unknown, scale: number, pooled: number): HeightField {
    const f = heightField(expanded(OneSheetConfig.parse(rawConfig), scale, pooled))
    return Comlink.transfer(f, [f.h.buffer, f.slope.buffer])
  },
}

export type OneSheetWorkerApi = typeof api
Comlink.expose(api)
