declare module 'sql.js' {
  interface SqlJsStatic {
    Database(data?: ArrayLike<number> | Buffer | null): Database;
  }

  interface QueryExecResult {
    columns: string[];
    values: unknown[][];
  }

  interface Statement {
    bind(params?: unknown[]): boolean;
    step(): boolean;
    getAsObject(params?: object): Record<string, unknown>;
    free(): boolean;
    reset(): void;
  }

  interface Database {
    run(sql: string, params?: unknown[]): Database;
    exec(sql: string): QueryExecResult[];
    prepare(sql: string): Statement;
    export(): Uint8Array;
    close(): void;
    getRowsModified(): number;
  }

  interface SqlJsConfig {
    locateFile: (file: string) => string;
  }

  export default function initSqlJs(config?: SqlJsConfig): Promise<SqlJsStatic>;
  export { SqlJsStatic, Database, Statement, QueryExecResult };
}
