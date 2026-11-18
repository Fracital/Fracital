declare module "yt-search" {
	interface Video {
		type: "video";
		videoId: string;
		title: string;
		url: string;
		/** The search result's snippet of the description; may be cut short. */
		description: string;
		seconds: number;
		timestamp: string;
		duration: { seconds: number; timestamp: string };
		views: number;
		ago: string;
		thumbnail: string;
		author: { name: string; url: string };
	}
	interface SearchResult {
		videos: Video[];
	}
	function ytSearch(query: string): Promise<SearchResult>;
	export default ytSearch;
}
