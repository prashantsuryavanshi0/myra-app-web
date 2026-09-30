package com.aayat.assistant;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

import androidx.core.content.ContextCompat;

import java.util.ArrayList;
import java.util.Locale;

/**
 * Background me "Hello Myra" sunta hai (Android SpeechRecognizer).
 * Match hone par DeviceControlPlugin.emitWake() call karta hai.
 */
public class WakeWordService {
    private final MainActivity activity;
    private SpeechRecognizer recognizer;
    private String[] words = { "myra", "hello myra", "hey myra" };
    private boolean running = false;
    private final Handler main = new Handler(Looper.getMainLooper());

    WakeWordService(MainActivity activity) {
        this.activity = activity;
    }

    void setWords(String[] w) {
        if (w != null && w.length > 0) this.words = w;
    }

    boolean start() {
        if (ContextCompat.checkSelfPermission(activity, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED)
            return false;
        if (!SpeechRecognizer.isRecognitionAvailable(activity)) return false;
        running = true;
        main.post(this::listen);
        return true;
    }

    void stop() {
        running = false;
        main.post(() -> {
            if (recognizer != null) {
                recognizer.destroy();
                recognizer = null;
            }
        });
    }

    private void listen() {
        if (!running) return;
        if (recognizer == null) {
            recognizer = SpeechRecognizer.createSpeechRecognizer(activity);
            recognizer.setRecognitionListener(new Listener());
        }
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-IN");
        i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        try {
            recognizer.startListening(i);
        } catch (Exception e) {
            restart(800);
        }
    }

    private void restart(long delay) {
        if (!running) return;
        main.postDelayed(() -> {
            if (recognizer != null) try { recognizer.cancel(); } catch (Exception ignored) {}
            listen();
        }, delay);
    }

    private String matchWake(ArrayList<String> results) {
        if (results == null) return null;
        for (String phrase : results) {
            String t = phrase.toLowerCase(Locale.ROOT).trim();
            for (String w : words) {
                int idx = t.indexOf(w);
                if (idx >= 0) return t.substring(idx + w.length()).trim();
            }
        }
        return null;
    }

    private class Listener implements RecognitionListener {
        @Override public void onResults(Bundle b) {
            String rest = matchWake(b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION));
            if (rest != null) activity.emitWake(rest);
            restart(300);
        }
        @Override public void onPartialResults(Bundle b) {
            String rest = matchWake(b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION));
            if (rest != null) {
                activity.emitWake(rest);
                restart(300);
            }
        }
        @Override public void onError(int error) { restart(error == SpeechRecognizer.ERROR_NO_MATCH ? 200 : 1000); }
        @Override public void onEndOfSpeech() {}
        @Override public void onReadyForSpeech(Bundle b) {}
        @Override public void onBeginningOfSpeech() {}
        @Override public void onRmsChanged(float v) {}
        @Override public void onBufferReceived(byte[] b) {}
        @Override public void onEvent(int e, Bundle b) {}
    }
}
