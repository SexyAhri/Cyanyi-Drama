declare module "sql.js" {
  export type SqlValue = unknown;

  export interface Statement {
    bind(parameters?: SqlValue[] | Record<string, SqlValue>): void;
    step(): boolean;
    getAsObject(): Record<string, unknown>;
    free(): void;
  }

  export interface Database {
    run(sql: string, params?: SqlValue[] | Record<string, SqlValue>): void;
    prepare(sql: string): Statement;
    export(): Uint8Array;
  }

  export interface SqlJsStatic {
    Database: new (data?: Uint8Array) => Database;
  }

  export default function initSqlJs(config?: {
    locateFile?: (file: string) => string;
  }): Promise<SqlJsStatic>;
}
