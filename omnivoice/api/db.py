import sqlite3
import json
import uuid
import time
import logging
from pathlib import Path
from typing import List, Dict, Optional, Any

logger = logging.getLogger("omnivoice.db")

DATA_DIR = Path("data")
DB_PATH = DATA_DIR / "tasks.db"
OUTPUTS_DIR = Path("outputs")
OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)


def get_db_connection() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH), timeout=60.0, check_same_thread=False)
    conn.execute("PRAGMA busy_timeout = 60000;")
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = get_db_connection()
    try:
        conn.execute("PRAGMA journal_mode = WAL;")
        conn.execute("PRAGMA synchronous = NORMAL;")
        cursor = conn.cursor()

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS voice_tasks (
            id TEXT PRIMARY KEY,
            order_num INTEGER,
            task_type TEXT NOT NULL,
            text TEXT NOT NULL,
            voice_id TEXT,
            voice_name TEXT,
            language TEXT DEFAULT 'Auto',
            instruct TEXT,
            params_json TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            progress INTEGER DEFAULT 0,
            audio_url TEXT,
            filename TEXT,
            duration_sec REAL,
            generation_time_sec REAL,
            error_message TEXT,
            created_at TEXT NOT NULL,
            started_at TEXT,
            completed_at TEXT
        )
        """)

        # Add columns if they do not already exist
        for col, col_type in [
            ("batch_id", "TEXT"),
            ("parent_id", "TEXT"),
            ("is_master", "INTEGER DEFAULT 1"),
            ("total_chunks", "INTEGER DEFAULT 1"),
            ("completed_chunks", "INTEGER DEFAULT 0"),
            ("gap_sec", "REAL DEFAULT 0.8"),
            ("srt_url", "TEXT"),
            ("srt_filename", "TEXT"),
        ]:
            try:
                cursor.execute(f"ALTER TABLE voice_tasks ADD COLUMN {col} {col_type}")
            except sqlite3.OperationalError:
                pass

        cursor.execute("CREATE INDEX IF NOT EXISTS idx_tasks_status ON voice_tasks (status)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_tasks_order ON voice_tasks (order_num)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_tasks_created ON voice_tasks (created_at)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_tasks_batch ON voice_tasks (batch_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_tasks_parent ON voice_tasks (parent_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_tasks_is_master ON voice_tasks (is_master)")

        # Create table for merged audio batches
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS merged_batches (
            id TEXT PRIMARY KEY,
            batch_id TEXT UNIQUE,
            title TEXT,
            audio_url TEXT NOT NULL,
            filename TEXT NOT NULL,
            duration_sec REAL,
            chunks_count INTEGER,
            gap_sec REAL DEFAULT 0.8,
            created_at TEXT NOT NULL
        )
        """)

        # Reset any tasks stuck in 'processing' when server was shut down/restarted
        cursor.execute("""
        UPDATE voice_tasks 
        SET status = 'pending', started_at = NULL 
        WHERE status = 'processing'
        """)

        conn.commit()
    finally:
        conn.close()

    # Automatically purge expired history (>48h) and any leftover merged chunk or orphaned files on startup
    try:
        cleanup_expired_history(retention_hours=48.0)
        cleanup_merged_chunk_files()
        cleanup_orphaned_outputs()
    except Exception as cleanup_err:
        logger.warning(f"Initial cleanup warning: {cleanup_err}")


def _get_next_order_num(cursor: sqlite3.Cursor) -> int:
    cursor.execute("SELECT MAX(order_num) FROM voice_tasks")
    row = cursor.fetchone()
    if row and row[0] is not None:
        return row[0] + 1
    return 1


def create_task(
    task_type: str,
    text: str,
    voice_id: Optional[str] = None,
    voice_name: Optional[str] = None,
    language: str = "Auto",
    instruct: Optional[str] = None,
    params: Optional[Dict[str, Any]] = None,
    status: str = "pending",
    batch_id: Optional[str] = None,
    parent_id: Optional[str] = None,
    is_master: int = 1,
    total_chunks: int = 1,
    completed_chunks: int = 0,
    gap_sec: float = 0.8,
) -> Dict[str, Any]:
    conn = get_db_connection()
    cursor = conn.cursor()

    task_id = f"task_{uuid.uuid4().hex[:10]}"
    order_num = _get_next_order_num(cursor)
    now = time.strftime("%Y-%m-%d %H:%M:%S")
    params_json = json.dumps(params or {}, ensure_ascii=False)

    cursor.execute(
        """
        INSERT INTO voice_tasks (
            id, order_num, task_type, text, voice_id, voice_name,
            language, instruct, params_json, status, progress, batch_id,
            parent_id, is_master, total_chunks, completed_chunks, gap_sec, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            task_id,
            order_num,
            task_type,
            text.strip(),
            voice_id,
            voice_name,
            language,
            instruct.strip() if instruct else None,
            params_json,
            status,
            batch_id,
            parent_id,
            is_master,
            total_chunks,
            completed_chunks,
            gap_sec,
            now,
        ),
    )

    conn.commit()
    task = get_task(task_id, conn=conn)
    conn.close()
    return task


def create_long_form_master_task(
    text: str,
    voice_id: Optional[str] = None,
    voice_name: Optional[str] = None,
    language: str = "Auto",
    instruct: Optional[str] = None,
    params: Optional[Dict[str, Any]] = None,
    chunk_size: int = 1000,
    gap_sec: float = 0.8,
    task_type: str = "clone",
) -> Dict[str, Any]:
    """
    Creates ONE master task representing the whole transcript.
    Splits text into coherent chunks (~1000 chars ending at full sentences).
    Creates sub-tasks for each chunk. The master task tracks overall progress
    and will be automatically merged into 1 audio file upon completion.
    """
    from omnivoice.api.audio_ops import split_text_by_sentence_chunks

    text = text.strip()
    if not text:
        raise ValueError("Text cannot be empty.")

    chunks = split_text_by_sentence_chunks(text, target_chars=chunk_size)
    if not chunks:
        chunks = [text]

    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        master_id = f"task_{uuid.uuid4().hex[:10]}"
        order_num = _get_next_order_num(cursor)
        now = time.strftime("%Y-%m-%d %H:%M:%S")

        params_dict = dict(params or {})
        params_dict["chunk_size"] = chunk_size
        params_dict["gap_sec"] = gap_sec
        params_dict["total_chunks"] = len(chunks)
        params_json = json.dumps(params_dict, ensure_ascii=False)

        # 1. Insert Master Task (is_master = 1)
        cursor.execute(
            """
            INSERT INTO voice_tasks (
                id, order_num, task_type, text, voice_id, voice_name,
                language, instruct, params_json, status, progress, batch_id,
                parent_id, is_master, total_chunks, completed_chunks, gap_sec, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, NULL, NULL, 1, ?, 0, ?, ?)
            """,
            (
                master_id,
                order_num,
                task_type,
                text,
                voice_id,
                voice_name,
                language,
                instruct.strip() if instruct else None,
                params_json,
                len(chunks),
                gap_sec,
                now,
            ),
        )

        # 2. If len(chunks) > 1, create sub-tasks for each chunk (is_master = 0)
        if len(chunks) > 1:
            for i, chunk_text in enumerate(chunks):
                sub_id = f"sub_{uuid.uuid4().hex[:10]}"
                sub_params = dict(params_dict)
                sub_params["chunk_index"] = i
                sub_params["total_chunks"] = len(chunks)
                sub_params_json = json.dumps(sub_params, ensure_ascii=False)

                cursor.execute(
                    """
                    INSERT INTO voice_tasks (
                        id, order_num, task_type, text, voice_id, voice_name,
                        language, instruct, params_json, status, progress, batch_id,
                        parent_id, is_master, total_chunks, completed_chunks, gap_sec, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, NULL, ?, 0, 1, 0, ?, ?)
                    """,
                    (
                        sub_id,
                        order_num,
                        task_type,
                        chunk_text,
                        voice_id,
                        voice_name,
                        language,
                        instruct.strip() if instruct else None,
                        sub_params_json,
                        master_id,
                        gap_sec,
                        now,
                    ),
                )

        conn.commit()
        master_task = get_task(master_id, conn=conn)
        return master_task
    finally:
        conn.close()


def update_master_task_progress(master_id: str) -> Optional[Dict[str, Any]]:
    """
    Updates the overall progress of a master task based on its sub-chunks.
    When all sub-chunks are completed, automatically merges them into a single audio file with gap_sec.
    """
    from omnivoice.api.audio_ops import merge_audio_files

    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM voice_tasks WHERE id = ?", (master_id,))
        master_row = cursor.fetchone()
        if not master_row:
            return None
        master = dict(master_row)

        cursor.execute("SELECT * FROM voice_tasks WHERE parent_id = ? ORDER BY rowid ASC", (master_id,))
        sub_rows = cursor.fetchall()
        if not sub_rows:
            return master

        sub_tasks = [dict(r) for r in sub_rows]
        total = len(sub_tasks)
        completed = sum(1 for t in sub_tasks if t["status"] == "completed")
        failed = sum(1 for t in sub_tasks if t["status"] == "failed")
        
        running_sub = next((t for t in sub_tasks if t["status"] == "processing"), None)
        running_sub_contrib = (running_sub.get("progress", 10) / 100.0) if running_sub else 0.0

        if completed == total:
            progress = 100
        elif total > 0:
            progress = min(99, max(5 if (running_sub or completed > 0) else 0, int(((completed + running_sub_contrib) / total) * 100)))
        else:
            progress = 0

        now = time.strftime("%Y-%m-%d %H:%M:%S")

        # If all sub-chunks are completed, merge audio!
        if completed == total:
            file_paths = []
            for t in sub_tasks:
                if t.get("filename"):
                    fp = OUTPUTS_DIR / t["filename"]
                    if fp.exists():
                        file_paths.append(fp)

            gap_sec = master.get("gap_sec") or 0.8
            output_filename = f"merged_{master_id}.wav"
            output_path = OUTPUTS_DIR / output_filename
            duration_sec = 0.0
            audio_url = None

            if file_paths:
                duration_sec, sr = merge_audio_files(file_paths, output_path, gap_sec=gap_sec)
                audio_url = f"/api/audio/output_{output_filename}"

            total_gen_time = round(sum(t.get("generation_time_sec") or 0.0 for t in sub_tasks), 2)
            if total_gen_time <= 0 and master.get("started_at"):
                try:
                    t_start = time.mktime(time.strptime(master["started_at"], "%Y-%m-%d %H:%M:%S"))
                    t_end = time.mktime(time.strptime(now, "%Y-%m-%d %H:%M:%S"))
                    total_gen_time = round(max(0.0, t_end - t_start), 2)
                except Exception:
                    pass

            # Merge SRT subtitles if present
            srt_paths = []
            chunk_durs = []
            for t in sub_tasks:
                s_fn = t.get("srt_filename") or (t.get("filename", "").rsplit(".", 1)[0] + ".srt" if t.get("filename") else None)
                if s_fn:
                    s_fp = OUTPUTS_DIR / s_fn
                    if s_fp.exists():
                        srt_paths.append(str(s_fp))
                        chunk_durs.append(float(t.get("duration_sec") or 0.0))

            master_srt_filename = f"merged_{master_id}.srt"
            master_srt_path = OUTPUTS_DIR / master_srt_filename
            master_srt_url = None
            if srt_paths and len(srt_paths) == len(chunk_durs):
                try:
                    from omnivoice.api.forced_alignment_srt import merge_srt_files
                    res = merge_srt_files(srt_paths, chunk_durs, str(master_srt_path), gap_sec=gap_sec)
                    if res:
                        master_srt_url = f"/api/audio/output_{master_srt_filename}"
                except Exception as srt_e:
                    logger.warning(f"Failed to merge SRTs for master task {master_id}: {srt_e}")

            # Delete chunk audio and SRT files once merge is complete
            keep_list = [output_filename]
            if master_srt_url:
                keep_list.append(master_srt_filename)
            del_count = delete_chunk_files(sub_tasks, keep_files=keep_list)
            logger.info(f"Cleaned up {del_count} chunk files for master task {master_id}.")

            cursor.execute(
                """
                UPDATE voice_tasks
                SET status = 'completed', progress = 100, completed_chunks = ?,
                    audio_url = ?, filename = ?, duration_sec = ?, 
                    generation_time_sec = ?, srt_url = ?, srt_filename = ?, completed_at = ?
                WHERE id = ?
                """,
                (completed, audio_url, output_filename, duration_sec, total_gen_time, master_srt_url, master_srt_filename if master_srt_url else None, now, master_id),
            )
            # Clear chunk file references on sub-tasks in DB
            cursor.execute(
                """
                UPDATE voice_tasks
                SET filename = NULL, audio_url = NULL, srt_filename = NULL, srt_url = NULL
                WHERE parent_id = ?
                """,
                (master_id,),
            )
        elif failed > 0 and (completed + failed == total):
            cursor.execute(
                """
                UPDATE voice_tasks
                SET status = 'failed', progress = ?, completed_chunks = ?,
                    error_message = ?, completed_at = ?
                WHERE id = ?
                """,
                (progress, completed, f"{failed} đoạn bị lỗi", now, master_id),
            )
        else:
            # Still in progress
            cursor.execute(
                """
                UPDATE voice_tasks
                SET status = 'processing', progress = ?, completed_chunks = ?,
                    started_at = COALESCE(started_at, ?)
                WHERE id = ?
                """,
                (progress, completed, now, master_id),
            )

        conn.commit()
        return get_task(master_id, conn=conn)
    finally:
        conn.close()


def create_batch_tasks(
    items: List[Dict[str, Any]],
    common_type: str = "clone",
    common_voice_id: Optional[str] = None,
    common_voice_name: Optional[str] = None,
    common_language: str = "Auto",
    common_instruct: Optional[str] = None,
    common_params: Optional[Dict[str, Any]] = None,
    batch_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Creates multiple tasks in a single database transaction.
    Each item can have {'text': ..., 'instruct': ..., etc.}
    """
    conn = get_db_connection()
    try:
        cursor = conn.cursor()

        created_tasks = []
        base_order = _get_next_order_num(cursor)
        now = time.strftime("%Y-%m-%d %H:%M:%S")
        assigned_batch_id = batch_id or f"batch_{uuid.uuid4().hex[:10]}"

        for i, item in enumerate(items):
            text = item.get("text", "").strip()
            if not text:
                continue

            task_id = f"task_{uuid.uuid4().hex[:10]}"
            order_num = base_order + i
            t_type = item.get("task_type") or common_type or "clone"
            v_id = item.get("voice_id") or common_voice_id
            v_name = item.get("voice_name") or common_voice_name
            lang = item.get("language") or common_language or "Auto"
            inst = item.get("instruct") or common_instruct
            if inst:
                inst = inst.strip()

            # Merge params
            p = dict(common_params or {})
            if "params" in item and isinstance(item["params"], dict):
                p.update(item["params"])
            params_json = json.dumps(p, ensure_ascii=False)

            cursor.execute(
                """
                INSERT INTO voice_tasks (
                    id, order_num, task_type, text, voice_id, voice_name,
                    language, instruct, params_json, status, progress, batch_id, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)
                """,
                (
                    task_id,
                    order_num,
                    t_type,
                    text,
                    v_id,
                    v_name,
                    lang,
                    inst,
                    params_json,
                    assigned_batch_id,
                    now,
                ),
            )

            created_tasks.append(task_id)

        conn.commit()

        # Retrieve all created tasks
        results = []
        for tid in created_tasks:
            t = get_task(tid, conn=conn)
            if t:
                results.append(t)

        return results
    finally:
        conn.close()


def get_task(task_id: str, conn: Optional[sqlite3.Connection] = None) -> Optional[Dict[str, Any]]:
    should_close = False
    if conn is None:
        conn = get_db_connection()
        should_close = True

    cursor = conn.cursor()
    cursor.execute("SELECT * FROM voice_tasks WHERE id = ?", (task_id,))
    row = cursor.fetchone()

    res = None
    if row:
        res = dict(row)
        if res.get("params_json"):
            try:
                res["params"] = json.loads(res["params_json"])
            except Exception:
                res["params"] = {}
        else:
            res["params"] = {}

    if should_close:
        conn.close()
    return res


def list_tasks(
    status: Optional[str] = None,
    limit: int = 200,
    offset: int = 0,
    master_only: bool = True,
) -> List[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()

    conditions = []
    params = []

    if master_only:
        conditions.append("(is_master = 1 OR is_master IS NULL)")

    if status and status != "all":
        conditions.append("status = ?")
        params.append(status)

    where_sql = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    query = f"""
        SELECT * FROM voice_tasks 
        {where_sql}
        ORDER BY order_num DESC 
        LIMIT ? OFFSET ?
    """
    params.extend([limit, offset])
    cursor.execute(query, tuple(params))

    rows = cursor.fetchall()
    tasks = []
    for r in rows:
        t = dict(r)
        if t.get("params_json"):
            try:
                t["params"] = json.loads(t["params_json"])
            except Exception:
                t["params"] = {}
        else:
            t["params"] = {}
        tasks.append(t)

    conn.close()
    return tasks


def get_next_pending_task() -> Optional[Dict[str, Any]]:
    """Finds the earliest pending task to execute (FIFO by order_num).
    Only selects executable sub-tasks or standalone single tasks.
    Container master tasks with multiple sub-chunks are processed via their chunks.
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT * FROM voice_tasks 
        WHERE status = 'pending' AND (is_master = 0 OR total_chunks = 1 OR total_chunks IS NULL)
        ORDER BY order_num ASC, rowid ASC 
        LIMIT 1
        """
    )
    row = cursor.fetchone()
    res = None
    if row:
        res = dict(row)
        if res.get("params_json"):
            try:
                res["params"] = json.loads(res["params_json"])
            except Exception:
                res["params"] = {}
        else:
            res["params"] = {}
    conn.close()
    return res


def update_task_status(
    task_id: str,
    status: str,
    progress: Optional[int] = None,
    audio_url: Optional[str] = None,
    filename: Optional[str] = None,
    duration_sec: Optional[float] = None,
    generation_time_sec: Optional[float] = None,
    srt_url: Optional[str] = None,
    srt_filename: Optional[str] = None,
    error_message: Optional[str] = None,
    started: bool = False,
    completed: bool = False,
) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()

    updates = ["status = ?"]
    params: List[Any] = [status]

    if progress is not None:
        updates.append("progress = ?")
        params.append(progress)
    if audio_url is not None:
        updates.append("audio_url = ?")
        params.append(audio_url)
    if filename is not None:
        updates.append("filename = ?")
        params.append(filename)
    if duration_sec is not None:
        updates.append("duration_sec = ?")
        params.append(round(duration_sec, 2))
    if generation_time_sec is not None:
        updates.append("generation_time_sec = ?")
        params.append(round(generation_time_sec, 2))
    if srt_url is not None:
        updates.append("srt_url = ?")
        params.append(srt_url)
    if srt_filename is not None:
        updates.append("srt_filename = ?")
        params.append(srt_filename)
    if error_message is not None:
        updates.append("error_message = ?")
        params.append(error_message)

    now = time.strftime("%Y-%m-%d %H:%M:%S")
    if started:
        updates.append("started_at = ?")
        params.append(now)
    if completed:
        updates.append("completed_at = ?")
        params.append(now)

    params.append(task_id)
    if status == "processing":
        sql = f"UPDATE voice_tasks SET {', '.join(updates)} WHERE id = ? AND status NOT IN ('completed', 'failed', 'cancelled')"
    else:
        sql = f"UPDATE voice_tasks SET {', '.join(updates)} WHERE id = ?"
    cursor.execute(sql, tuple(params))
    affected = cursor.rowcount
    conn.commit()
    conn.close()
    return affected > 0


def retry_task(task_id: str) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        UPDATE voice_tasks 
        SET status = 'pending', progress = 0, error_message = NULL,
            audio_url = NULL, filename = NULL, started_at = NULL, completed_at = NULL 
        WHERE id = ? AND status IN ('failed', 'cancelled')
        """,
        (task_id,),
    )
    conn.commit()
    conn.close()
    return get_task(task_id)


def cancel_task(task_id: str) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        UPDATE voice_tasks 
        SET status = 'cancelled', completed_at = ? 
        WHERE id = ? AND status = 'pending'
        """,
        (time.strftime("%Y-%m-%d %H:%M:%S"), task_id),
    )
    affected = cursor.rowcount
    conn.commit()
    conn.close()
    return affected > 0


def delete_task(task_id: str) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()

    # 1. Collect all filenames for this task and its subtasks
    cursor.execute(
        "SELECT filename, srt_filename FROM voice_tasks WHERE id = ? OR parent_id = ?",
        (task_id, task_id),
    )
    rows = cursor.fetchall()
    for r in rows:
        for f in [r["filename"], r["srt_filename"]]:
            if f:
                fp = OUTPUTS_DIR / f
                if fp.exists() and fp.is_file():
                    try:
                        fp.unlink()
                        logger.info(f"Deleted task file: {f}")
                    except Exception as e:
                        logger.warning(f"Failed to delete file {f}: {e}")
                stem = Path(f).stem
                for ext in [".wav", ".mp3", ".srt"]:
                    alt = OUTPUTS_DIR / f"{stem}{ext}"
                    if alt.exists() and alt.is_file():
                        try:
                            alt.unlink()
                        except Exception:
                            pass

    cursor.execute("DELETE FROM voice_tasks WHERE id = ? OR parent_id = ?", (task_id, task_id))
    affected = cursor.rowcount
    conn.commit()
    conn.close()
    return affected > 0


def cleanup_orphaned_outputs(conn: Optional[sqlite3.Connection] = None) -> int:
    """
    Deletes any files in outputs/ that are not referenced by any task or merged batch in SQLite.
    This ensures that when tasks or history are cleared, no orphaned audio or SRT files linger on disk.
    """
    should_close = False
    if conn is None:
        conn = get_db_connection()
        should_close = True

    deleted_count = 0
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT filename, srt_filename FROM voice_tasks")
        known_files = set()
        for r in cursor.fetchall():
            if r["filename"]:
                known_files.add(Path(r["filename"]).name)
            if r["srt_filename"]:
                known_files.add(Path(r["srt_filename"]).name)

        cursor.execute("SELECT filename FROM merged_batches")
        for r in cursor.fetchall():
            if r["filename"]:
                known_files.add(Path(r["filename"]).name)
                known_files.add(Path(r["filename"]).stem + ".srt")

        if OUTPUTS_DIR.exists():
            for p in OUTPUTS_DIR.iterdir():
                if p.is_file():
                    if p.name not in known_files:
                        try:
                            p.unlink()
                            deleted_count += 1
                            logger.info(f"Deleted orphaned output file: {p.name}")
                        except Exception as e:
                            logger.warning(f"Failed to delete orphaned file {p.name}: {e}")
    except Exception as e:
        logger.error(f"Error during cleanup_orphaned_outputs: {e}", exc_info=True)
    finally:
        if should_close:
            conn.close()

    return deleted_count


def clear_completed_tasks(master_only: bool = True) -> int:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT id FROM voice_tasks WHERE status IN ('completed', 'failed', 'cancelled') AND (is_master = 1 OR is_master IS NULL)"
    )
    rows = cursor.fetchall()
    count = 0

    if rows:
        ids = [r[0] for r in rows]
        placeholders = ",".join(["?"] * len(ids))

        # 1. Find all audio and srt files of these tasks and their subtasks
        cursor.execute(
            f"SELECT filename, srt_filename FROM voice_tasks WHERE id IN ({placeholders}) OR parent_id IN ({placeholders})",
            ids + ids,
        )
        file_rows = cursor.fetchall()
        for r in file_rows:
            for f in [r["filename"], r["srt_filename"]]:
                if f:
                    fp = OUTPUTS_DIR / f
                    if fp.exists() and fp.is_file():
                        try:
                            fp.unlink()
                            logger.info(f"Deleted task file on clear: {f}")
                        except Exception as e:
                            logger.warning(f"Failed to delete task file {f}: {e}")
                    stem = Path(f).stem
                    for ext in [".wav", ".mp3", ".srt"]:
                        alt = OUTPUTS_DIR / f"{stem}{ext}"
                        if alt.exists() and alt.is_file():
                            try:
                                alt.unlink()
                            except Exception:
                                pass

        cursor.execute(f"DELETE FROM voice_tasks WHERE parent_id IN ({placeholders})", ids)
        cursor.execute(f"DELETE FROM voice_tasks WHERE id IN ({placeholders})", ids)
        count = len(ids)

    # 2. Check if all tasks are cleared, also clear merged_batches
    cursor.execute("SELECT COUNT(*) FROM voice_tasks")
    remaining_tasks = cursor.fetchone()[0]
    if remaining_tasks == 0:
        cursor.execute("SELECT filename FROM merged_batches")
        for mb in cursor.fetchall():
            fn = mb["filename"]
            if fn:
                fp = OUTPUTS_DIR / fn
                if fp.exists() and fp.is_file():
                    try:
                        fp.unlink()
                    except Exception:
                        pass
                s_fp = OUTPUTS_DIR / (Path(fn).stem + ".srt")
                if s_fp.exists() and s_fp.is_file():
                    try:
                        s_fp.unlink()
                    except Exception:
                        pass
        cursor.execute("DELETE FROM merged_batches")

    conn.commit()

    # 3. Clean up any remaining orphaned files in outputs/
    deleted_orphans = cleanup_orphaned_outputs(conn=conn)
    logger.info(f"clear_completed_tasks: {count} tasks deleted, {deleted_orphans} orphaned files deleted.")

    conn.close()
    return count


def get_task_stats(master_only: bool = True) -> Dict[str, int]:
    conn = get_db_connection()
    cursor = conn.cursor()
    where_sql = "WHERE (is_master = 1 OR is_master IS NULL)" if master_only else ""
    cursor.execute(
        f"""
        SELECT status, COUNT(*) as count 
        FROM voice_tasks 
        {where_sql}
        GROUP BY status
        """
    )
    rows = cursor.fetchall()
    stats = {
        "total": 0,
        "pending": 0,
        "processing": 0,
        "completed": 0,
        "failed": 0,
        "cancelled": 0,
    }
    total = 0
    for r in rows:
        st = r["status"]
        cnt = r["count"]
        total += cnt
        if st in stats:
            stats[st] = cnt

    stats["total"] = total
    conn.close()
    return stats


def get_sub_tasks(master_id: str) -> List[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT * FROM voice_tasks WHERE parent_id = ? ORDER BY rowid ASC",
        (master_id,),
    )
    rows = cursor.fetchall()
    conn.close()
    tasks = []
    for r in rows:
        t = dict(r)
        if t.get("params_json"):
            try:
                t["params"] = json.loads(t["params_json"])
            except Exception:
                t["params"] = {}
        else:
            t["params"] = {}
        tasks.append(t)
    return tasks


def get_tasks_by_ids(task_ids: List[str]) -> List[Dict[str, Any]]:
    """Retrieves tasks corresponding to the given IDs in the exact order requested"""
    if not task_ids:
        return []
    conn = get_db_connection()
    cursor = conn.cursor()
    placeholders = ",".join(["?"] * len(task_ids))
    cursor.execute(f"SELECT * FROM voice_tasks WHERE id IN ({placeholders})", task_ids)
    rows = cursor.fetchall()
    conn.close()

    tasks_map = {}
    for r in rows:
        t = dict(r)
        if t.get("params_json"):
            try:
                t["params"] = json.loads(t["params_json"])
            except Exception:
                t["params"] = {}
        else:
            t["params"] = {}
        tasks_map[t["id"]] = t

    return [tasks_map[tid] for tid in task_ids if tid in tasks_map]


def get_tasks_by_batch_id(batch_id: str) -> List[Dict[str, Any]]:
    """Retrieves all tasks in a batch ordered by order_num ASC"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT * FROM voice_tasks WHERE batch_id = ? ORDER BY order_num ASC",
        (batch_id,),
    )
    rows = cursor.fetchall()
    conn.close()

    tasks = []
    for r in rows:
        t = dict(r)
        if t.get("params_json"):
            try:
                t["params"] = json.loads(t["params_json"])
            except Exception:
                t["params"] = {}
        else:
            t["params"] = {}
        tasks.append(t)
    return tasks


def save_merged_batch(
    batch_id: str,
    title: str,
    audio_url: str,
    filename: str,
    duration_sec: float,
    chunks_count: int,
    gap_sec: float = 0.8,
) -> Dict[str, Any]:
    conn = get_db_connection()
    cursor = conn.cursor()
    record_id = f"merge_{uuid.uuid4().hex[:10]}"
    now = time.strftime("%Y-%m-%d %H:%M:%S")

    cursor.execute(
        """
        INSERT OR REPLACE INTO merged_batches (
            id, batch_id, title, audio_url, filename, duration_sec, chunks_count, gap_sec, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            record_id,
            batch_id,
            title,
            audio_url,
            filename,
            duration_sec,
            chunks_count,
            gap_sec,
            now,
        ),
    )
    conn.commit()
    conn.close()

    return {
        "id": record_id,
        "batch_id": batch_id,
        "title": title,
        "audio_url": audio_url,
        "filename": filename,
        "duration_sec": duration_sec,
        "chunks_count": chunks_count,
        "gap_sec": gap_sec,
        "created_at": now,
    }


def get_merged_batch(batch_id: str) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM merged_batches WHERE batch_id = ? ORDER BY created_at DESC LIMIT 1", (batch_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None


def list_merged_batches(limit: int = 50) -> List[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM merged_batches ORDER BY created_at DESC LIMIT ?", (limit,))
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]


def delete_chunk_files(tasks_or_filenames: List[Any], keep_files: Optional[List[str]] = None) -> int:
    """Safely removes intermediate chunk audio (.wav, .mp3, etc.) and srt files from disk after merging."""
    keep_names = set(Path(f).name for f in (keep_files or []))
    deleted_count = 0

    for item in tasks_or_filenames:
        fn = None
        srt_fn = None
        if isinstance(item, dict):
            fn = item.get("filename")
            srt_fn = item.get("srt_filename")
        elif isinstance(item, (str, Path)):
            fn = Path(item).name

        candidates = set()
        if fn:
            candidates.add(fn)
            stem = Path(fn).stem
            for ext in [".wav", ".mp3", ".flac", ".ogg", ".aac", ".m4a"]:
                candidates.add(f"{stem}{ext}")
            if not srt_fn:
                candidates.add(f"{stem}.srt")
        if srt_fn:
            candidates.add(srt_fn)

        for candidate in candidates:
            if candidate in keep_names:
                continue
            fp = OUTPUTS_DIR / candidate
            if fp.exists() and fp.is_file():
                try:
                    fp.unlink()
                    deleted_count += 1
                    logger.info(f"Deleted chunk file: {candidate}")
                except Exception as e:
                    logger.warning(f"Failed to delete chunk file {candidate}: {e}")

    return deleted_count


def cleanup_merged_chunk_files() -> int:
    """Scans and deletes any leftover chunk files for tasks or batches that have already been merged."""
    conn = get_db_connection()
    deleted_total = 0
    try:
        cursor = conn.cursor()
        # 1. Clean up sub-tasks of completed master tasks
        cursor.execute(
            "SELECT id, filename, srt_filename FROM voice_tasks WHERE status = 'completed' AND is_master = 1"
        )
        masters = cursor.fetchall()
        for m in masters:
            m_id = m["id"]
            keep_files = [f for f in [m["filename"], m["srt_filename"]] if f]
            cursor.execute(
                "SELECT filename, srt_filename FROM voice_tasks WHERE parent_id = ?",
                (m_id,),
            )
            subs = [dict(r) for r in cursor.fetchall()]
            if subs:
                deleted_total += delete_chunk_files(subs, keep_files=keep_files)
                cursor.execute(
                    "UPDATE voice_tasks SET filename = NULL, audio_url = NULL, srt_filename = NULL, srt_url = NULL WHERE parent_id = ?",
                    (m_id,),
                )

        # 2. Clean up chunk files of merged batches
        cursor.execute("SELECT batch_id, filename FROM merged_batches")
        batches = cursor.fetchall()
        for b in batches:
            b_id = b["batch_id"]
            if not b_id:
                continue
            keep_files = [b["filename"], Path(b["filename"]).stem + ".srt"]
            cursor.execute(
                "SELECT filename, srt_filename FROM voice_tasks WHERE batch_id = ?",
                (b_id,),
            )
            batch_tasks = [dict(r) for r in cursor.fetchall()]
            if batch_tasks:
                deleted_total += delete_chunk_files(batch_tasks, keep_files=keep_files)
                cursor.execute(
                    "UPDATE voice_tasks SET filename = NULL, audio_url = NULL, srt_filename = NULL, srt_url = NULL WHERE batch_id = ?",
                    (b_id,),
                )

        conn.commit()
    except Exception as e:
        logger.error(f"Error cleaning up merged chunk files: {e}", exc_info=True)
    finally:
        conn.close()

    return deleted_total


def cleanup_expired_history(retention_hours: float = 48.0) -> Dict[str, int]:
    """
    Purges task records and merged batches older than retention_hours (default 48h).
    Also deletes their associated audio (.wav, .mp3) and subtitle (.srt) files from disk,
    as well as any orphaned files in outputs/ older than retention_hours.
    """
    from datetime import datetime, timedelta

    cutoff_dt = datetime.now() - timedelta(hours=retention_hours)
    cutoff_str = cutoff_dt.strftime("%Y-%m-%d %H:%M:%S")
    cutoff_epoch = time.time() - (retention_hours * 3600)

    conn = get_db_connection()
    deleted_tasks_count = 0
    deleted_batches_count = 0
    deleted_files_count = 0

    try:
        cursor = conn.cursor()

        # 1. Expired voice_tasks
        cursor.execute(
            "SELECT id, filename, srt_filename FROM voice_tasks WHERE created_at < ?",
            (cutoff_str,),
        )
        expired_tasks = cursor.fetchall()
        for row in expired_tasks:
            for f in [row["filename"], row["srt_filename"]]:
                if f:
                    fp = OUTPUTS_DIR / f
                    if fp.exists() and fp.is_file():
                        try:
                            fp.unlink()
                            deleted_files_count += 1
                        except Exception as e:
                            logger.warning(f"Error removing expired task file {f}: {e}")
                    stem = Path(f).stem
                    for ext in [".wav", ".mp3", ".srt"]:
                        alt_fp = OUTPUTS_DIR / f"{stem}{ext}"
                        if alt_fp.exists() and alt_fp.is_file():
                            try:
                                alt_fp.unlink()
                                deleted_files_count += 1
                            except Exception:
                                pass

        if expired_tasks:
            task_ids = [r["id"] for r in expired_tasks]
            for i in range(0, len(task_ids), 100):
                batch = task_ids[i : i + 100]
                placeholders = ",".join(["?"] * len(batch))
                cursor.execute(f"DELETE FROM voice_tasks WHERE id IN ({placeholders})", batch)
            deleted_tasks_count = len(task_ids)

        # 2. Expired merged_batches
        cursor.execute(
            "SELECT id, filename FROM merged_batches WHERE created_at < ?",
            (cutoff_str,),
        )
        expired_batches = cursor.fetchall()
        for row in expired_batches:
            fn = row["filename"]
            if fn:
                fp = OUTPUTS_DIR / fn
                if fp.exists() and fp.is_file():
                    try:
                        fp.unlink()
                        deleted_files_count += 1
                    except Exception as e:
                        logger.warning(f"Error removing expired batch file {fn}: {e}")
                # Also check srt
                s_fp = OUTPUTS_DIR / (Path(fn).stem + ".srt")
                if s_fp.exists() and s_fp.is_file():
                    try:
                        s_fp.unlink()
                        deleted_files_count += 1
                    except Exception as e:
                        logger.warning(f"Error removing expired batch srt {s_fp.name}: {e}")

        if expired_batches:
            b_ids = [r["id"] for r in expired_batches]
            placeholders = ",".join(["?"] * len(b_ids))
            cursor.execute(f"DELETE FROM merged_batches WHERE id IN ({placeholders})", b_ids)
            deleted_batches_count = len(b_ids)

        conn.commit()

        # 3. Clean up any leftover or orphaned files in outputs/ older than retention_hours
        orphans_del = cleanup_orphaned_outputs(conn=conn)
        deleted_files_count += orphans_del

        if OUTPUTS_DIR.exists():
            for p in OUTPUTS_DIR.iterdir():
                if p.is_file():
                    try:
                        mtime = p.stat().st_mtime
                        if mtime < cutoff_epoch:
                            p.unlink()
                            deleted_files_count += 1
                            logger.info(f"Removed expired output file: {p.name} (age > {retention_hours}h)")
                    except Exception as e:
                        logger.warning(f"Error checking/removing old output file {p.name}: {e}")

        logger.info(
            f"[History Retention] Purged records older than {retention_hours}h: "
            f"{deleted_tasks_count} tasks, {deleted_batches_count} batches, {deleted_files_count} files removed."
        )
    except Exception as e:
        logger.error(f"Error during expired history cleanup: {e}", exc_info=True)
    finally:
        conn.close()

    return {
        "deleted_tasks": deleted_tasks_count,
        "deleted_batches": deleted_batches_count,
        "deleted_files": deleted_files_count,
    }

