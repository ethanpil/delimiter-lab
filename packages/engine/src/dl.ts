/* The one namespace of the engine.
 *
 * Every file of the engine puts its work on this object, and every file reads the work of the
 * others from it. The browser gives the same object the name self.DL, so the page and the worker
 * see what they saw before. Node brings it in as a module. One source, every platform.
 */
export const DL: any = {};
export default DL;
