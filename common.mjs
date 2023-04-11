export async function* doInChunks(arr, n, f) {
    const commonChunkInfo = {size: n, lastIndex: Math.ceil(arr.length/n)-1};
    for (let i = 0; i < arr.length; i += n) {
        const chunkInfo = {...commonChunkInfo, index: i};
        yield await f(arr.slice(i, i + n), chunkInfo).then((response) => ({
            response,
            chunkInfo
        }));
    }
}