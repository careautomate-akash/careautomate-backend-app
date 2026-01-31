from fastapi import FastAPI, File, UploadFile, HTTPException, Form
import uvicorn
import os
import logging
import speech_recognition as sr
import tempfile

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

@app.post("/transcribe/")
async def transcribe(file: UploadFile = File(...), language: str = Form("en-US")):
    logger.info(f"Received file: {file.filename}, content_type: {file.content_type}, language: {language}")
    
    try:
        # Create temp directory if it doesn't exist
        if not os.path.exists("temp"):
            os.makedirs("temp")
        
        # Save the file to a temporary file
        with tempfile.NamedTemporaryFile(delete=False, suffix='.wav') as tmp:
            tmp_path = tmp.name
            contents = await file.read()
            
            if not contents:
                logger.error("Received empty file")
                raise HTTPException(status_code=400, detail="Empty file")
                
            logger.info(f"File size: {len(contents)} bytes")
            tmp.write(contents)
            
        logger.info(f"File saved to {tmp_path}")
        
        # Initialize the recognizer
        recognizer = sr.Recognizer()
        
        # Convert audio file to AudioFile
        with sr.AudioFile(tmp_path) as source:
            audio_data = recognizer.record(source)
            
            # Use Google Speech Recognition with the specified language
            text = recognizer.recognize_google(audio_data, language=language)
            logger.info(f"Transcription result: {text}")
            
            # Clean up the temporary file
            try:
                os.unlink(tmp_path)
            except Exception as e:
                logger.warning(f"Could not delete temporary file: {e}")
                
            return {"text": text}
            
    except sr.UnknownValueError:
        logger.error(f"Google Speech Recognition could not understand audio (language: {language})")
        return {"text": "Audio not understood. Please speak clearly or try a different audio file."}
    except sr.RequestError as e:
        logger.error(f"Could not request results from Google Speech Recognition service: {e}")
        return {"text": "Speech recognition service unavailable. Please try again later."}
    except Exception as e:
        logger.error(f"Error processing file: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error processing file: {str(e)}")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8001)
