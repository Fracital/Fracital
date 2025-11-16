import { useEffect, useState } from "react";
import { AudioVisualizer } from "audvis";

interface AudvisVisualizerProps {
	audioRef: React.RefObject<HTMLAudioElement | null>;
	isPlaying: boolean;
	width?: number;
	height?: number;
	color?: string;
	opacity?: number;
	scale?: number;
	className?: string;
}

// Global singleton for audio context and analyser
const globalAudioState = {
	context: null as AudioContext | null,
	analyser: null as AnalyserNode | null,
	source: null as MediaElementAudioSourceNode | null,
	audioElement: null as HTMLAudioElement | null,
};

export const AudvisVisualizer = ({ audioRef, isPlaying, width = 300, height = 100, color = "#ffffff", opacity = 1, scale = 1, className = "" }: AudvisVisualizerProps) => {
	const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

	useEffect(() => {
		if (!audioRef.current) return;

		if (globalAudioState.audioElement === audioRef.current && globalAudioState.analyser) {
			setAnalyser(globalAudioState.analyser);
			return;
		}

		if (!globalAudioState.context || globalAudioState.audioElement !== audioRef.current) {
			try {
				const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
				const analyserNode = audioContext.createAnalyser();
				const source = audioContext.createMediaElementSource(audioRef.current);

				analyserNode.fftSize = 2048;
				analyserNode.smoothingTimeConstant = 0.8;

				source.connect(analyserNode);
				analyserNode.connect(audioContext.destination);

				globalAudioState.context = audioContext;
				globalAudioState.analyser = analyserNode;
				globalAudioState.source = source;
				globalAudioState.audioElement = audioRef.current;

				setAnalyser(analyserNode);
				console.log("Audvis initialized successfully");
			} catch (error) {
				console.error("Error initializing audvis:", error);
			}
		} else {
			setAnalyser(globalAudioState.analyser);
		}
	}, [audioRef]);

	if (!analyser) return null;

	return (
		<div
			className={className}
			style={{
				width: `${width}px`,
				height: `${height}px`,
				opacity,
				transform: `scale(${scale})`,
				transition: "all 0.3s ease",
			}}
		>
			<AudioVisualizer analyser={analyser} isActive={isPlaying} width={width} height={height} color={color} />
		</div>
	);
};
