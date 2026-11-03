declare module "yt-search" {
	interface Video {
		videoId: string;
		title: string;
		url: string;
		duration: { seconds: number; timestamp: string };
		thumbnail: string;
		author: { name: string };
	}
	interface SearchResult {
		videos: Video[];
	}
	function ytSearch(query: string): Promise<SearchResult>;
	export default ytSearch;
}
