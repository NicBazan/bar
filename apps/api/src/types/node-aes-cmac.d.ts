declare module "node-aes-cmac" {
  export interface AesCmacOptions {
    returnAsBuffer?: boolean;
  }

  export function aesCmac(
    key: Buffer | string,
    message: Buffer | string,
    options?: AesCmacOptions,
  ): Buffer | string;
}
