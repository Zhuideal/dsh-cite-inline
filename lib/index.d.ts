/**
 * Host half of dsh-cite-inline: a name and a no-op apply.
 *
 * The browser half (`./client`) owns every behavior; see `client.js`.
 */
export declare const name = "dsh-cite-inline";
export declare function apply(): void;
declare const _default: {
    name: string;
    apply: typeof apply;
};
export default _default;